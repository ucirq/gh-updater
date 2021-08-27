use serde::Deserialize;
use x509_parser::pem::parse_x509_pem;
use x509_parser::error::{PEMError};
use x509_parser::nom::Finish;

#[derive(Deserialize, Debug, Clone)]
pub struct Config {
    pub installation_id: u64,
    pub app_id: u64,
    pub private_key_pem: String,
    pub repo_owner: String,
    pub repo_name: String,
    pub file_to_edit: String,
    pub image_name: String,
    pub new_name: Option<String>,
    #[serde(alias = "circle_sha1")]
    pub new_tag: Option<String>,
}

impl Config {
    pub fn private_key_der(&self) -> Result<Vec<u8>, PEMError> {
        let processed = self.private_key_pem.replace('^', "\n");
        parse_x509_pem(processed.as_bytes()).finish().map(|(_, pem)| pem.contents)
    }
}
