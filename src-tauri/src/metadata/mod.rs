pub mod a1111;
pub mod civitai;
pub mod comfyui;
pub mod guidance;
pub mod invokeai;
pub mod models;
pub mod parsers;
pub mod photo;
pub mod reparse;
pub mod resources;
pub mod thumbs_scan;
pub mod utils;

use std::collections::BTreeMap;
pub mod video;

pub use a1111::extract_a1111_metadata;
pub use comfyui::extract_comfyui_metadata;
pub use invokeai::extract_invokeai_metadata;
pub use parsers::{extract_png_chunks, scan_jpeg_metadata, scan_webp_metadata};

/// Current parser version. Increment when any parser logic changes.
/// Images with parser_version < CURRENT_PARSER_VERSION will be queued
/// for background re-parsing from their stored original_metadata_json.
pub const CURRENT_PARSER_VERSION: u32 = 49;

/// Video metadata evolves independently from the mature image parsers.
pub const VIDEO_PARSER_VERSION: u32 = 1;

/// Weights within this distance are the same weight (they print identically to two decimals).
pub(crate) const WEIGHT_TOLERANCE: f64 = 0.005;

/// One weight per name, kept only when every application of that name used the same weight;
/// a model applied at different strengths has no single weight, so it gets none.
pub(crate) fn consistent_weights(entries: impl IntoIterator<Item = (String, f64)>) -> BTreeMap<String, f64> {
    let mut weights = BTreeMap::new();
    let mut conflicting = std::collections::BTreeSet::new();
    for (name, weight) in entries {
        if !weight.is_finite() || conflicting.contains(&name) {
            continue;
        }
        match weights.get(&name) {
            Some(existing) if (existing - weight).abs() >= WEIGHT_TOLERANCE => {
                weights.remove(&name);
                conflicting.insert(name);
            }
            Some(_) => {}
            None => {
                weights.insert(name, weight);
            }
        }
    }
    weights
}

pub(crate) fn is_missing_prompt_value(value: &str) -> bool {
    value.trim().is_empty() || is_placeholder_prompt_value(value)
}

pub(crate) fn is_placeholder_prompt_value(value: &str) -> bool {
    let trimmed = value.trim();
    const POSITIVE_PROMPT_PREFIX: &str = "positive prompt:";
    let candidate = trimmed
        .get(..POSITIVE_PROMPT_PREFIX.len())
        .filter(|prefix| prefix.eq_ignore_ascii_case(POSITIVE_PROMPT_PREFIX))
        .map(|_| &trimmed[POSITIVE_PROMPT_PREFIX.len()..])
        .unwrap_or(trimmed)
        .trim_matches(|c: char| c.is_whitespace() || c == ',' || c == ';');

    candidate.eq_ignore_ascii_case("undefined")
        || candidate.eq_ignore_ascii_case("null")
        || candidate.eq_ignore_ascii_case("none")
        || candidate.eq_ignore_ascii_case("unknown")
        || candidate.eq_ignore_ascii_case("negative prompt:")
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, specta::Type, PartialEq)]
pub struct ImageMetadata {
    pub tool: String,
    pub model: String,
    #[serde(rename = "rawParameters", skip_serializing_if = "Option::is_none")]
    pub raw_parameters: Option<String>,
    pub steps: u32,
    pub cfg: f32,
    #[serde(skip)]
    #[specta(skip)]
    pub(crate) cfg_present: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seed: Option<i64>,
    pub sampler: String,
    #[serde(rename = "positivePrompt")]
    pub positive_prompt: String,
    #[serde(rename = "negativePrompt")]
    pub negative_prompt: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub loras: Vec<String>,
    /// Model strength per entry of `loras`, for parsers whose LoRA names carry no weight.
    #[serde(rename = "loraWeights", default, skip_serializing_if = "BTreeMap::is_empty")]
    pub lora_weights: BTreeMap<String, f64>,
    #[serde(rename = "controlNets", skip_serializing_if = "Vec::is_empty")]
    pub control_nets: Vec<String>,
    /// Strength per entry of `control_nets`, when every unit applying it agrees.
    #[serde(rename = "controlNetWeights", default, skip_serializing_if = "BTreeMap::is_empty")]
    pub control_net_weights: BTreeMap<String, f64>,
    #[serde(rename = "ipAdapters", skip_serializing_if = "Vec::is_empty")]
    pub ip_adapters: Vec<String>,
    /// Weight per entry of `ip_adapters`, when every node applying it agrees.
    #[serde(rename = "ipAdapterWeights", default, skip_serializing_if = "BTreeMap::is_empty")]
    pub ip_adapter_weights: BTreeMap<String, f64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub embeddings: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub hypernetworks: Vec<String>,
    /// Supporting models: VAEs, upscale models, CLIP Vision encoders, and detection models.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub vaes: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub upscalers: Vec<String>,
    #[serde(rename = "clipVisions", default, skip_serializing_if = "Vec::is_empty")]
    pub clip_visions: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub detectors: Vec<String>,
    #[serde(rename = "variationId", skip_serializing_if = "Option::is_none")]
    pub variation_id: Option<String>,
    #[serde(rename = "isIntermediate", default)]
    pub is_intermediate: bool,
    #[serde(rename = "isGrid", default)]
    pub is_grid: bool,
    #[serde(rename = "workflowJson", skip_serializing_if = "Option::is_none")]
    pub workflow_json: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vae: Option<String>,
    #[serde(rename = "clipSkip", skip_serializing_if = "Option::is_none")]
    pub clip_skip: Option<u32>,
    #[serde(rename = "denoisingStrength", skip_serializing_if = "Option::is_none")]
    pub denoising_strength: Option<f32>,
    #[serde(rename = "hiresUpscale", skip_serializing_if = "Option::is_none")]
    pub hires_upscale: Option<f32>,
    #[serde(rename = "hiresSteps", skip_serializing_if = "Option::is_none")]
    pub hires_steps: Option<u32>,
    #[serde(rename = "hiresUpscaler", skip_serializing_if = "Option::is_none")]
    pub hires_upscaler: Option<String>,
    #[serde(rename = "modelHash", skip_serializing_if = "Option::is_none")]
    pub model_hash: Option<String>,
    #[serde(rename = "generationType")]
    pub generation_type: String,
    #[serde(rename = "isFavorite", default)]
    pub is_favorite: bool,
    #[serde(rename = "hasWorkflowHint", default)]
    pub has_workflow_hint: bool,
}

impl ImageMetadata {
    pub fn is_incomplete(&self) -> bool {
        // Considered incomplete if we are missing key generation data
        (self.model.is_empty() || self.model == "Unknown" || self.model == "None")
            || is_missing_prompt_value(&self.positive_prompt)
            || is_placeholder_prompt_value(&self.negative_prompt)
            || self.steps == 0
    }

    pub fn merge_if_missing(&mut self, other: ImageMetadata) {
        if self.model.is_empty() || self.model == "Unknown" || self.model == "None" {
            self.model = other.model;
        }
        if self.steps == 0 {
            self.steps = other.steps;
        }
        if !self.cfg_present && self.cfg == 0.0 {
            self.cfg = other.cfg;
            self.cfg_present = other.cfg_present || other.cfg != 0.0;
        }
        if self.seed.is_none() {
            self.seed = other.seed;
        }
        if self.sampler.is_empty()
            || self.sampler == "Unknown"
            || self.sampler == "_"
            || self.sampler.starts_with("Unknown (")
            || self.sampler.starts_with("_ (")
        {
            self.sampler = other.sampler;
        }
        if is_missing_prompt_value(&self.positive_prompt) {
            self.positive_prompt = other.positive_prompt;
        }
        if is_missing_prompt_value(&self.negative_prompt) {
            self.negative_prompt = other.negative_prompt;
        }
        if self.generation_type == "unknown" && other.generation_type != "unknown" {
            self.generation_type = other.generation_type;
        }

        // Always merge collections
        for x in other.loras {
            if !self.loras.contains(&x) {
                self.loras.push(x);
            }
        }
        for (name, weight) in other.lora_weights {
            self.lora_weights.entry(name).or_insert(weight);
        }
        for x in other.control_nets {
            if !self.control_nets.contains(&x) {
                self.control_nets.push(x);
            }
        }
        for (name, weight) in other.control_net_weights {
            self.control_net_weights.entry(name).or_insert(weight);
        }
        for x in other.ip_adapters {
            if !self.ip_adapters.contains(&x) {
                self.ip_adapters.push(x);
            }
        }
        for (name, weight) in other.ip_adapter_weights {
            self.ip_adapter_weights.entry(name).or_insert(weight);
        }
        for x in other.embeddings {
            if !self.embeddings.contains(&x) {
                self.embeddings.push(x);
            }
        }
        for x in other.hypernetworks {
            if !self.hypernetworks.contains(&x) {
                self.hypernetworks.push(x);
            }
        }
        self.merge_auxiliary_resources(other.vaes, other.upscalers, other.clip_visions, other.detectors);
    }

    /// The supporting-model lists, in `crate::db::SUPPORTING_MODEL_JUNCTIONS` order.
    pub(crate) fn supporting_model_lists(&self) -> [&[String]; 4] {
        [&self.vaes, &self.upscalers, &self.clip_visions, &self.detectors]
    }

    pub(crate) fn merge_auxiliary_resources(
        &mut self,
        vaes: Vec<String>,
        upscalers: Vec<String>,
        clip_visions: Vec<String>,
        detectors: Vec<String>,
    ) {
        for (target, values) in [
            (&mut self.vaes, vaes),
            (&mut self.upscalers, upscalers),
            (&mut self.clip_visions, clip_visions),
            (&mut self.detectors, detectors),
        ] {
            for value in values {
                if !target.contains(&value) {
                    target.push(value);
                }
            }
        }
    }

    /// Text-format generators (A1111, Forge, ...) record the VAE and hires upscaler as single
    /// fields; list them as supporting models too. Placeholders and latent upscale modes are skipped.
    pub fn finalize_auxiliary_resources(&mut self) {
        let named = |value: &Option<String>| {
            value
                .as_deref()
                .map(str::trim)
                .filter(|name| {
                    !name.is_empty()
                        && !["none", "automatic", "auto", "unknown", "baked vae"]
                            .contains(&name.to_ascii_lowercase().as_str())
                })
                .map(crate::metadata::guidance::GuidanceClassifier::clean_name)
        };
        if let Some(vae) = named(&self.vae) {
            if !self.vaes.contains(&vae) {
                self.vaes.push(vae);
            }
        }
        if let Some(upscaler) = named(&self.hires_upscaler)
            .filter(|name| !name.contains("latent") && !name.starts_with("nearest") && !name.starts_with("lanczos"))
        {
            if !self.upscalers.contains(&upscaler) {
                self.upscalers.push(upscaler);
            }
        }
    }

    pub fn merge(&mut self, other: ImageMetadata) {
        // General merge - overwrites even if present if other is "better"?
        // For now alias to merge_metadata function behavior but as a method
        merge_metadata(self, other);
    }
}

impl Default for ImageMetadata {
    fn default() -> Self {
        Self {
            tool: "Unknown".to_string(),
            model: "Unknown".to_string(),
            raw_parameters: None,
            steps: 0,
            cfg: 0.0,
            cfg_present: false,
            seed: None,
            sampler: "Unknown".to_string(),
            positive_prompt: String::new(),
            negative_prompt: String::new(),
            loras: Vec::new(),
            lora_weights: BTreeMap::new(),
            control_nets: Vec::new(),
            control_net_weights: BTreeMap::new(),
            ip_adapters: Vec::new(),
            ip_adapter_weights: BTreeMap::new(),
            embeddings: Vec::new(),
            hypernetworks: Vec::new(),
            vaes: Vec::new(),
            upscalers: Vec::new(),
            clip_visions: Vec::new(),
            detectors: Vec::new(),
            variation_id: None,
            is_intermediate: false,
            is_grid: false,
            workflow_json: None,
            vae: None,
            clip_skip: None,
            denoising_strength: None,
            hires_upscale: None,
            hires_steps: None,
            hires_upscaler: None,
            model_hash: None,
            generation_type: "unknown".to_string(),
            is_favorite: false,
            has_workflow_hint: false,
        }
    }
}

pub fn merge_metadata(base: &mut ImageMetadata, secondary: ImageMetadata) {
    if base.tool == "Unknown" && secondary.tool != "Unknown" {
        base.tool = secondary.tool.clone();
    }

    // Merge favorites (if either is true, result is true)
    if secondary.is_favorite {
        base.is_favorite = true;
    }

    if base.model == "Unknown" || base.model.is_empty() || base.model == "None" {
        base.model = secondary.model;
    }

    if base.steps == 0 || (secondary.tool == "ComfyUI" && secondary.steps > 0) {
        base.steps = secondary.steps;
    }
    let base_cfg_present = base.cfg_present || base.cfg != 0.0;
    let secondary_cfg_present = secondary.cfg_present || secondary.cfg != 0.0;
    if (!base_cfg_present && secondary_cfg_present)
        || (secondary.tool == "ComfyUI" && secondary.cfg > 0.0)
    {
        base.cfg = secondary.cfg;
        base.cfg_present = secondary_cfg_present;
    }
    if base.seed.is_none() || (secondary.tool == "ComfyUI" && secondary.seed.is_some()) {
        base.seed = secondary.seed;
    }

    if base.sampler == "Unknown"
        || base.sampler.is_empty()
        || base.sampler == "_"
        || base.sampler.starts_with("Unknown (")
        || (secondary.tool == "ComfyUI"
            && !secondary.sampler.is_empty()
            && secondary.sampler != "Unknown")
    {
        base.sampler = secondary.sampler;
    }

    if is_missing_prompt_value(&base.positive_prompt) {
        base.positive_prompt = secondary.positive_prompt;
    }

    if is_missing_prompt_value(&base.negative_prompt) {
        base.negative_prompt = secondary.negative_prompt;
    }

    if base.workflow_json.is_none() {
        base.workflow_json = secondary.workflow_json;
    }

    if !base.has_workflow_hint && secondary.has_workflow_hint {
        base.has_workflow_hint = true;
    }

    if base.vae.is_none() {
        base.vae = secondary.vae;
    }
    if base.clip_skip.is_none() {
        base.clip_skip = secondary.clip_skip;
    }
    if base.denoising_strength.is_none() {
        base.denoising_strength = secondary.denoising_strength;
    }
    if base.hires_upscale.is_none() {
        base.hires_upscale = secondary.hires_upscale;
    }
    if base.hires_steps.is_none() {
        base.hires_steps = secondary.hires_steps;
    }
    if base.hires_upscaler.is_none() {
        base.hires_upscaler = secondary.hires_upscaler;
    }
    if base.model_hash.is_none() {
        base.model_hash = secondary.model_hash;
    }

    // Merge generation type (prefer specific over 'unknown')
    if (base.generation_type.is_empty() || base.generation_type == "unknown")
        && !secondary.generation_type.is_empty()
        && secondary.generation_type != "unknown"
    {
        base.generation_type = secondary.generation_type;
    }

    // Union for resources
    for lora in secondary.loras {
        if !base.loras.contains(&lora) {
            base.loras.push(lora);
        }
    }
    for (name, weight) in secondary.lora_weights {
        base.lora_weights.entry(name).or_insert(weight);
    }

    for cn in secondary.control_nets {
        if !base.control_nets.contains(&cn) {
            base.control_nets.push(cn);
        }
    }
    for (name, weight) in secondary.control_net_weights {
        base.control_net_weights.entry(name).or_insert(weight);
    }

    for ip in secondary.ip_adapters {
        if !base.ip_adapters.contains(&ip) {
            base.ip_adapters.push(ip);
        }
    }
    for (name, weight) in secondary.ip_adapter_weights {
        base.ip_adapter_weights.entry(name).or_insert(weight);
    }

    for emb in secondary.embeddings {
        if !base.embeddings.contains(&emb) {
            base.embeddings.push(emb);
        }
    }

    for hn in secondary.hypernetworks {
        if !base.hypernetworks.contains(&hn) {
            base.hypernetworks.push(hn);
        }
    }
    base.merge_auxiliary_resources(
        secondary.vaes,
        secondary.upscalers,
        secondary.clip_visions,
        secondary.detectors,
    );
}

pub fn detect_generation_type(path: &std::path::Path) -> String {
    let lower_path = path.to_string_lossy().to_lowercase().replace('\\', "/");
    if lower_path.contains("/txt2img-images")
        || lower_path.contains("/outputs/txt2img")
        || lower_path.contains("/txt2img/")
        || lower_path.contains("/text/")
    {
        "txt2img".to_string()
    } else if lower_path.contains("/img2img-images")
        || lower_path.contains("/outputs/img2img")
        || lower_path.contains("/img2img/")
        || lower_path.contains("/image/")
    {
        "img2img".to_string()
    } else if lower_path.contains("/extras-images")
        || lower_path.contains("/outputs/extras")
        || lower_path.contains("/extras/")
        || lower_path.contains("/save")
        || lower_path.contains("/saved")
    {
        "extras".to_string()
    } else if lower_path.contains("-grids") || lower_path.contains("/grids/") {
        "grid".to_string()
    } else {
        "unknown".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_detect_generation_type() {
        assert_eq!(
            detect_generation_type(&PathBuf::from("/path/to/txt2img-images/image.png")),
            "txt2img"
        );
        assert_eq!(
            detect_generation_type(&PathBuf::from("/path/to/img2img-images/image.png")),
            "img2img"
        );
        assert_eq!(
            detect_generation_type(&PathBuf::from("/path/to/extras-images/image.png")),
            "extras"
        );
        assert_eq!(
            detect_generation_type(&PathBuf::from("/path/to/txt2img-grids/image.png")),
            "grid"
        );
        assert_eq!(
            detect_generation_type(&PathBuf::from(
                "D:/SDNext/outputs/txt2img/2023-10-01/image.png"
            )),
            "txt2img"
        );
        assert_eq!(
            detect_generation_type(&PathBuf::from("D:\\SDNext\\outputs\\txt2img\\image.png")),
            "txt2img"
        );
        assert_eq!(
            detect_generation_type(&PathBuf::from("/path/to/random/image.png")),
            "unknown"
        );
    }
    #[test]
    fn test_merge_metadata_override() {
        let mut base = ImageMetadata::default();
        base.tool = "A1111".to_string();
        base.sampler = "_".to_string(); // Simulate bad A1111 param
        base.steps = 0;
        base.cfg = 0.0;

        let mut secondary = ImageMetadata::default();
        secondary.tool = "ComfyUI".to_string();
        secondary.sampler = "euler".to_string();
        secondary.steps = 20;
        secondary.cfg = 3.5;

        merge_metadata(&mut base, secondary);

        assert_eq!(base.sampler, "euler");
        assert_eq!(base.steps, 20);
        assert_eq!(base.cfg, 3.5);
    }

    #[test]
    fn unknown_seed_is_omitted_but_zero_seed_is_preserved() {
        let unknown = serde_json::to_value(ImageMetadata::default()).expect("serialize metadata");
        assert!(unknown.get("seed").is_none());

        let mut zero = ImageMetadata::default();
        zero.seed = Some(0);
        zero.loras.push("lora".to_string());
        zero.control_nets.push("control".to_string());
        zero.ip_adapters.push("ip-adapter".to_string());
        zero.embeddings.push("embedding".to_string());
        zero.hypernetworks.push("hypernetwork".to_string());
        let serialized = serde_json::to_value(&zero).expect("serialize zero seed");

        assert_eq!(serialized.get("seed"), Some(&serde_json::json!(0)));
        assert_eq!(
            serde_json::from_value::<ImageMetadata>(serialized)
                .expect("deserialize zero seed")
                .seed,
            Some(0)
        );
    }

    #[test]
    fn merge_only_fills_an_unknown_seed() {
        let mut known_zero = ImageMetadata::default();
        known_zero.seed = Some(0);
        let mut secondary = ImageMetadata::default();
        secondary.seed = Some(42);

        known_zero.merge_if_missing(secondary.clone());
        assert_eq!(known_zero.seed, Some(0));

        let mut unknown = ImageMetadata::default();
        unknown.merge_if_missing(secondary);
        assert_eq!(unknown.seed, Some(42));
    }
}
