use serde::Deserialize;
use x509_parser::pem::parse_x509_pem;

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
    pub new_tag: Option<String>,
}

impl Config {
    pub fn private_key_der(&self) -> Vec<u8> {
        let (_, pem) = parse_x509_pem(self.private_key_pem.as_bytes()).unwrap();
        return pem.contents;
    }
}
