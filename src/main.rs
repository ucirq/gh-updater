use hubcaps::{Credentials, Github, InstallationTokenGenerator, JWTCredentials};
extern crate tokio;
use std::error::Error;
mod config;
mod yaml;

use crate::config::Config;
use crate::yaml::yaml_update;

fn setup_gh(config: &Config) -> Result<Github, Box<dyn Error>> {
    let key = config.private_key_der()?;
    let cred = JWTCredentials::new(config.app_id, key)?;
    let tokgen = InstallationTokenGenerator::new(config.installation_id, cred);
    let github = Github::new("gh-updater/0.1", Credentials::InstallationToken(tokgen))?;
    Ok(github)
}

fn commit_message(config: &Config) -> String {
    if let Some(x) = config.new_tag.clone() {
        format!("Setting SHA to {}", x)
    } else {
        "Automated update".to_string()
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = envy::from_env::<Config>()?;

    let github = setup_gh(&config.clone())?;
    let repo = github.repo(config.clone().repo_owner, config.clone().repo_name);

    let content = repo.content();

    let f = content.file(&config.clone().file_to_edit).await?;
    let data: &str = std::str::from_utf8(&f.content)?;
    let new_data = yaml_update(data, &config.clone()).await;
    if new_data == data {
        println!("No changes to commit");
        return Ok(());
    }
    let message = commit_message(&config);
    let res = content
        .update(&config.clone().file_to_edit, &new_data, &message, &f.sha)
        .await?;

    println!("Committed {}", res.commit.tree.sha);
    Ok(())
}