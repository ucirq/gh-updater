import * as core from "@actions/core";
import * as github from "@actions/github";
import { createAppAuth } from "@octokit/auth-app";
import { PushEvent } from "@octokit/webhooks-definitions/schema";
import { Command } from "commander";
import { Octokit } from "octokit";
import YawnYaml from "yawn-yaml/cjs";
const program = new Command();
program.option("--ignore <env>", "environment to skip");

program.parse(process.argv);

const options = program.opts();

function mustEnv(name: string, alt?: string): string {
  const value =
    process.env[name] ?? (alt != null ? process.env[alt] : undefined);
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

interface Configuration {
  readonly ciProvider: "github" | "circle";
  readonly privateKey: string;
  readonly appId: string;
  readonly installationId: string;

  readonly gitSha: string;
  readonly repoName: string;
  readonly repoOwner: string;
  readonly sourceRepoName: string;
  readonly imageName: string;
  readonly username: string | null;
}

function configurationFromEnv(): Configuration {
  const imageName = process.env.IMAGE_NAME ?? "app-image";
  const repoName = process.env.REPO_NAME ?? "k8s";
  if (process.env.GITHUB_ACTIONS === "true") {
    //if (github.context.eventName !== "push") {
    //  throw new Error("Only supports push events");
    //}
    const p = github.context.payload as PushEvent;
    return {
      ciProvider: "github",
      privateKey: core
        .getInput("PRIVATE_KEY_PEM", {
          required: true,
          trimWhitespace: false,
        })
        .replaceAll("^", "\n")
        .trim(),
      appId: core.getInput("APP_ID", { required: true }),
      installationId: core.getInput("INSTALLATION_ID", { required: true }),
      imageName,
      repoName,
      gitSha: p.after,
      sourceRepoName: p.repository.name,
      repoOwner: p.repository.owner.login,
      username: p.sender.login,
    };
  } else {
    const privateKey = mustEnv("PRIVATE_KEY_PEM").replaceAll("^", "\n").trim();
    const appId = mustEnv("APP_ID");
    const installationId = mustEnv("INSTALLATION_ID");
    return {
      ciProvider: "circle",
      privateKey,
      appId,
      installationId,
      gitSha: mustEnv("CIRCLE_SHA1"),
      repoName: process.env.REPO_NAME ?? "k8s",
      repoOwner: mustEnv("CIRCLE_PROJECT_USERNAME"),
      sourceRepoName: mustEnv("CIRCLE_PROJECT_REPONAME"),
      imageName,
      username: process.env.CIRCLE_USERNAME ?? null,
    };
  }
}

function octokitFromConfiguration({
  privateKey,
  appId,
  installationId,
}: Configuration): Octokit {
  try {
    const auth = {
      appId: parseInt(appId, 10),
      privateKey,
      installationId: parseInt(installationId, 10),
    };
    return new Octokit({
      authStrategy: createAppAuth,
      auth,
    });
  } catch (e) {
    console.log("Error in key" + privateKey.slice(0, 25));
    core.error(e as Error);
    core.error("Error in key" + privateKey.slice(0, 25));
    throw e;
  }
}

function path(configuration: Configuration, environment: string) {
  return `services/${configuration.sourceRepoName}/${environment}/kustomization.yaml`;
}

async function patchRepo(
  configuration: Configuration,
  octokit: Octokit,
  environment: string,
  branch = "master"
) {
  const fileLocation = {
    owner: configuration.repoOwner,
    repo: configuration.repoName,
    path: path(configuration, environment),
  };

  const { data } = await octokit.rest.repos.getContent(fileLocation);

  if (Array.isArray(data)) {
    throw new Error("Multiple files found at path");
  }
  if (!("content" in data)) {
    throw new Error("No content found at path");
  }
  const { content, sha } = data;

  const newYaml = patchYaml(configuration, content);

  let message = `Update ${
    configuration.sourceRepoName
  } ${environment} to ${configuration.gitSha.slice(0, 7)}`;
  if (configuration.username) {
    message += `\n\nSigned-off-by: ${configuration.username}\n`;
  }
  await octokit.rest.repos.createOrUpdateFileContents({
    ...fileLocation,
    content: Buffer.from(newYaml).toString("base64"),
    sha,
    message,
    branch,
  });
}

function patchYaml(configuration: Configuration, data: string): string {
  const yy = new YawnYaml(Buffer.from(data, "base64").toString("utf8"));

  const d = yy.json;

  if (!d["images"] || !Array.isArray(d["images"])) {
    d["images"] = [];
  }
  const images: Record<string, string>[] = d["images"];
  const img = images.find((x) => x.name === configuration.imageName);

  if (!img) {
    images.push({
      name: configuration.imageName,
      newTag: configuration.gitSha,
    });
  } else {
    img.newTag = configuration.gitSha;
  }
  yy.json = d;
  return yy.yaml;
}

async function findEnvironments(
  octokit: Octokit,
  configuration: Configuration
): Promise<string[]> {
  const folderLocation = {
    owner: configuration.repoOwner,
    repo: configuration.repoName,
    path: `services/${configuration.sourceRepoName}`,
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
  octokit: Octokit,
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

  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha,
  });
}

async function patchEnvironment(
  configuration: Configuration,
  octokit: Octokit,
  environment: string
) {
  const shouldPR = environmentShouldPR(environment);
  if (!shouldPR) {
    await patchRepo(configuration, octokit, environment);
  } else {
    const rand = Math.floor(Math.random() * 1000).toString(36);
    const branch = `auto-${configuration.gitSha}-${rand}`;

    await createBranchOffMaster(
      octokit,
      configuration.repoOwner,
      configuration.repoName,
      branch
    );
    await patchRepo(configuration, octokit, environment, branch);

    const pr = await octokit.rest.pulls.create({
      owner: configuration.repoOwner,
      repo: configuration.repoName,
      title: `Deploy \`${
        configuration.sourceRepoName
      }\` to ${environment}, ${configuration.gitSha.slice(0, 7)}`,
      head: branch,
      base: "master",
      maintainer_can_modify: true,
      body: "This is an automated pull-request.",
    });
    if (configuration.username) {
      await octokit.rest.pulls.requestReviewers({
        owner: configuration.repoOwner,
        repo: configuration.repoName,
        pull_number: pr.data.number,
        reviewers: [configuration.username],
      });
    }
  }
}

async function main() {
  const configuration = configurationFromEnv();
  console.log({ ...configuration, privateKey: undefined });
  const octokit = octokitFromConfiguration(configuration);
  const environments = await findEnvironments(octokit, configuration);
  const shouldPR = environments.filter((x) => environmentShouldPR(x));
  const nonPR = environments.filter((x) => !environmentShouldPR(x));
  const sortedEnvironments = nonPR.concat(shouldPR);
  for (const environment of sortedEnvironments) {
    await patchEnvironment(configuration, octokit, environment);
  }
}

main();
