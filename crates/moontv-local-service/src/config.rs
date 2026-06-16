use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::Path};

const DEFAULT_SITE_NAME: &str = "MoonTV";
const DEFAULT_ANNOUNCEMENT: &str = "本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。";
const DEFAULT_DOUBAN_PROXY_TYPE: &str = "cmliussss-cdn-tencent";
const DEFAULT_DOUBAN_IMAGE_PROXY_TYPE: &str = "cmliussss-cdn-tencent";
const DEFAULT_LIVE_USER_AGENT: &str = "AptvPlayer/1.4.10";

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct CustomCategory {
    pub name: String,
    pub r#type: String,
    pub query: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct ApiSiteConfig {
    #[serde(default)]
    pub api: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub referer: Option<String>,
    #[serde(default)]
    pub ua: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct LiveSourceConfig {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub epg: Option<String>,
    #[serde(default)]
    pub ua: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct RawServiceConfig {
    #[serde(default)]
    announcement: Option<String>,
    #[serde(default)]
    api_site: BTreeMap<String, ApiSiteConfig>,
    #[serde(default)]
    custom_category: Vec<CustomCategory>,
    #[serde(default)]
    douban_image_proxy: Option<String>,
    #[serde(default)]
    douban_image_proxy_type: Option<String>,
    #[serde(default)]
    douban_proxy: Option<String>,
    #[serde(default)]
    douban_proxy_type: Option<String>,
    #[serde(default = "default_fluid_search")]
    fluid_search: bool,
    #[serde(default)]
    enable_web_live: bool,
    #[serde(default)]
    lives: BTreeMap<String, LiveSourceConfig>,
    #[serde(default)]
    profile_sync_api_base_url: Option<String>,
    #[serde(default)]
    site_name: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ServiceConfig {
    announcement: String,
    api_sites: BTreeMap<String, ApiSiteConfig>,
    custom_categories: Vec<CustomCategory>,
    douban_image_proxy: Option<String>,
    douban_image_proxy_type: String,
    douban_proxy: Option<String>,
    douban_proxy_type: String,
    enable_web_live: bool,
    fluid_search: bool,
    live_sources: BTreeMap<String, LiveSourceConfig>,
    profile_sync_enabled: bool,
    site_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicConfigResponse {
    pub announcement: String,
    pub custom_categories: Vec<CustomCategory>,
    pub douban_image_proxy: Option<String>,
    pub douban_image_proxy_type: Option<String>,
    pub douban_proxy: Option<String>,
    pub douban_proxy_type: Option<String>,
    pub enable_web_live: bool,
    pub fluid_search: bool,
    pub profile_sync_enabled: bool,
    pub site_name: String,
}

impl Default for ServiceConfig {
    fn default() -> Self {
        Self {
            announcement: DEFAULT_ANNOUNCEMENT.to_string(),
            api_sites: BTreeMap::new(),
            custom_categories: Vec::new(),
            douban_image_proxy: None,
            douban_image_proxy_type: DEFAULT_DOUBAN_IMAGE_PROXY_TYPE.to_string(),
            douban_proxy: None,
            douban_proxy_type: DEFAULT_DOUBAN_PROXY_TYPE.to_string(),
            enable_web_live: false,
            fluid_search: true,
            live_sources: BTreeMap::new(),
            profile_sync_enabled: false,
            site_name: DEFAULT_SITE_NAME.to_string(),
        }
    }
}

impl ServiceConfig {
    pub fn api_site(&self, key: &str) -> Option<&ApiSiteConfig> {
        self.api_sites.get(key)
    }

    pub fn live_source(&self, key: &str) -> Option<&LiveSourceConfig> {
        self.live_sources.get(key)
    }

    pub fn to_public_config(&self) -> PublicConfigResponse {
        PublicConfigResponse {
            announcement: self.announcement.clone(),
            custom_categories: self.custom_categories.clone(),
            douban_image_proxy: self.douban_image_proxy.clone(),
            douban_image_proxy_type: Some(self.douban_image_proxy_type.clone()),
            douban_proxy: self.douban_proxy.clone(),
            douban_proxy_type: Some(self.douban_proxy_type.clone()),
            enable_web_live: self.enable_web_live,
            fluid_search: self.fluid_search,
            profile_sync_enabled: self.profile_sync_enabled,
            site_name: self.site_name.clone(),
        }
    }
}

impl LiveSourceConfig {
    pub fn user_agent(&self) -> &str {
        self.ua
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(DEFAULT_LIVE_USER_AGENT)
    }
}

pub fn load_service_config(path: &Path) -> ServiceConfig {
    let Some(raw) = fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<RawServiceConfig>(&content).ok())
    else {
        return ServiceConfig::default();
    };

    ServiceConfig {
        announcement: normalize_required(raw.announcement, DEFAULT_ANNOUNCEMENT),
        api_sites: raw.api_site,
        custom_categories: raw.custom_category,
        douban_image_proxy: normalize_optional(raw.douban_image_proxy),
        douban_image_proxy_type: normalize_required(
            raw.douban_image_proxy_type,
            DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
        ),
        douban_proxy: normalize_optional(raw.douban_proxy),
        douban_proxy_type: normalize_required(raw.douban_proxy_type, DEFAULT_DOUBAN_PROXY_TYPE),
        enable_web_live: raw.enable_web_live,
        fluid_search: raw.fluid_search,
        live_sources: raw.lives,
        profile_sync_enabled: raw
            .profile_sync_api_base_url
            .as_deref()
            .map(str::trim)
            .map(|value| !value.is_empty())
            .unwrap_or(false),
        site_name: normalize_required(raw.site_name, DEFAULT_SITE_NAME),
    }
}

fn default_fluid_search() -> bool {
    true
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value.and_then(|candidate| {
        let trimmed = candidate.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_required(value: Option<String>, fallback: &str) -> String {
    normalize_optional(value).unwrap_or_else(|| fallback.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn falls_back_to_defaults_when_config_is_missing() {
        let config = load_service_config(Path::new("/definitely/missing/config.json"));

        let public_config = config.to_public_config();
        assert_eq!(public_config.site_name, "MoonTV");
        assert_eq!(
            public_config.douban_proxy_type.as_deref(),
            Some("cmliussss-cdn-tencent")
        );
        assert!(public_config.fluid_search);
        assert!(!public_config.profile_sync_enabled);
    }
}
