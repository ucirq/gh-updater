use crate::Config;
use linked_hash_map::{Entry, LinkedHashMap};
use yaml_rust::{EmitError, Yaml, YamlEmitter};

fn dump_to_string(y: &Yaml) -> Result<String, EmitError> {
    let mut out_str: String = String::new();
    let mut emitter = YamlEmitter::new(&mut out_str);
    emitter.dump(y)?; // dump the YAML object to a String
    Ok(out_str)
}

fn set_key_inplace(hm: &mut LinkedHashMap<Yaml, Yaml>, key: &str, val: &str) {
    match hm.entry(Yaml::String(key.to_string())) {
        Entry::Occupied(mut occ) => {
            *occ.get_mut() = Yaml::String(val.to_string());
        }
        Entry::Vacant(vac) => {
            vac.insert(Yaml::String(val.to_string()));
        }
    }
}

mod tests {
    #[tokio::test]
    async fn test_update_yaml() {
        use super::{yaml_update, Config};
        let cfg = Config {
            installation_id: 1,
            app_id: 1,
            private_key_pem: "".to_string(),
            repo_owner: "foobar".to_string(),
            repo_name: "foo".to_string(),
            file_to_edit: "foo".to_string(),
            image_name: "app-image".to_string(),
            new_name: Some("meow".to_string()),
            new_tag: Some("meow".to_string()),
        };
        let res = yaml_update(
            " 
    images: #cool file
      - 
        name: app-image
        newName: ghcr.io/creandum/colab-api
        newTag: cc01b9f6a37e40ac45acf1910bb587b2dca3834a
    ",
            &cfg,
        )
        .await;
        println!("{}", res);
    }
}

pub async fn yaml_update(yaml: &str, config: &Config) -> String {
    let mut y: Vec<yaml_rust::Yaml> = yaml_rust::YamlLoader::load_from_str(&yaml).unwrap();
    let root_yaml = y.get_mut(0).unwrap();
    match root_yaml {
        yaml_rust::Yaml::Hash(ref mut root_map) => {
            for mut root_entry in root_map.entries() {
                if root_entry.key().as_str().unwrap() == "images" {
                    let images = root_entry.get_mut();
                    match images {
                        Yaml::Array(ref mut images_array) => {
                            for image in images_array {
                                match image {
                                    Yaml::Hash(ref mut image_map) => {
                                        let name_key = &Yaml::String("name".to_string());
                                        if image_map.get(name_key)
                                            != Some(&Yaml::String(config.image_name.to_string()))
                                        {
                                            continue;
                                        }
                                        if let Some(new_name) = &config.new_name {
                                            set_key_inplace(image_map, &"newName", &new_name);
                                        }
                                        if let Some(new_tag) = &config.new_tag {
                                            set_key_inplace(image_map, &"newTag", &new_tag);
                                        }
                                    }
                                    _ => (),
                                }
                            }
                        }
                        _ => (),
                    }
                }
            }
        }
        _ => (),
    }
    dump_to_string(root_yaml).unwrap()
}
