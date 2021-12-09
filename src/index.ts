import { createAppAuth } from "@octokit/auth-app";
import { Command } from "commander";
import { Octokit } from "octokit";
import YawnYaml from "yawn-yaml/cjs";
const program = new Command();

program.option("--ignore <env>", "environment to skip");

program.parse(process.argv);

const options = program.opts();

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

const SKIP_PROD = process.argv;

const privateKey = mustEnv("PRIVATE_KEY_PEM").replaceAll("^", "\n").trim();

const octokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId: mustEnv("APP_ID"),
    privateKey,
    installationId: mustEnv("INSTALLATION_ID"),
  },
});

const GIT_SHA = mustEnv("CIRCLE_SHA1");
const REPO_NAME = process.env.REPO_NAME ?? "k8s";
const REPO_OWNER = mustEnv("CIRCLE_PROJECT_USERNAME");
const SOURCE_REPO_NAME = mustEnv("CIRCLE_PROJECT_REPONAME");
const IMAGE_NAME = process.env.IMAGE_NAME ?? "app-image";
const CIRCLE_USERNAME = process.env.CIRCLE_USERNAME;
function path(environment: string) {
  return `services/${SOURCE_REPO_NAME}/${environment}/kustomization.yaml`;
}

async function patchRepo(environment: string, branch: string = "master") {
  const fileLocation = {
    owner: REPO_OWNER,
    repo: REPO_NAME,
    path: path(environment),
  };

  const { data } = await octokit.rest.repos.getContent(fileLocation);

  if (Array.isArray(data)) {
    throw new Error("Multiple files found at path");
  }
  if (!("content" in data)) {
    throw new Error("No content found at path");
  }
  const { content, sha } = data;

  const newYaml = patchYaml(content);

  let message = `Update ${SOURCE_REPO_NAME} ${environment} to ${GIT_SHA.slice(
    0,
    7
  )}`;
  if (CIRCLE_USERNAME) {
    message += `\n Signed-off-by: ${CIRCLE_USERNAME}`;
  }
  await octokit.rest.repos.createOrUpdateFileContents({
    ...fileLocation,
    content: Buffer.from(newYaml).toString("base64"),
    sha,
    message,
    branch,
  });
}

function patchYaml(data: string): string {
  const yy = new YawnYaml(Buffer.from(data, "base64").toString("utf8"));

  const d = yy.json;

  if (!d["images"] || !Array.isArray(d["images"])) {
    d["images"] = [];
  }
  const images: Record<string, string>[] = d["images"];
  const img = images.find((x) => x.name === IMAGE_NAME);

  if (!img) {
    images.push({
      name: IMAGE_NAME,
      newTag: GIT_SHA,
    });
  } else {
    img.newTag = GIT_SHA;
  }
  yy.json = d;
  return yy.yaml;
}

async function findEnvironments(): Promise<string[]> {
  const folderLocation = {
    owner: REPO_OWNER,
    repo: REPO_NAME,
    path: `services/${SOURCE_REPO_NAME}`,
  };
  const folder = await octokit.rest.repos.getContent(folderLocation);
  if (!Array.isArray(folder.data)) {
    throw new Error("No folder found at path");
  }
  return folder.data
    .filter((x) => x.name !== "base")
    .filter((x) => !options.ignore || x.name !== options.ignore)
    .map((x) => x.name);
}

function environmentShouldPR(environment: string): boolean {
  return environment === "prod";
}

async function createBranchOffMaster(
  owner: string,
  repo: string,
  branch: string
) {
  const master = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/master`,
  });
  const sha = master.data.object.sha;

  const branchCreation = await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha,
  });
}

async function patchEnvironment(environment: string) {
  const shouldPR = environmentShouldPR(environment);
  if (!shouldPR) {
    await patchRepo(environment);
  } else {
    const rand = Math.floor(Math.random() * 1000).toString(36);
    const branch = `auto-${GIT_SHA}-${rand}`;

    await createBranchOffMaster(REPO_OWNER, REPO_NAME, branch);
    await patchRepo(environment, branch);

    const pr = await octokit.rest.pulls.create({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      title: `Deploy \`${SOURCE_REPO_NAME}\` to ${environment}, ${GIT_SHA.slice(
        0,
        7
      )}`,
      head: branch,
      base: "master",
      maintainer_can_modify: true,
      body: "This is an automated pull-request.",
    });
    if (CIRCLE_USERNAME) {
      await octokit.rest.pulls.requestReviewers({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        pull_number: pr.data.number,
        reviewers: [CIRCLE_USERNAME],
      });
    }
  }
}

async function main() {
  const environments = await findEnvironments();
  const shouldPR = environments.filter((x) => environmentShouldPR(x));
  const nonPR = environments.filter((x) => !environmentShouldPR(x));
  const sortedEnvironments = nonPR.concat(shouldPR);
  for (const environment of sortedEnvironments) {
    await patchEnvironment(environment);
  }
}

main();
