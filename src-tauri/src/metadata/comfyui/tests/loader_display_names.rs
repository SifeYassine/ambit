use crate::metadata::comfyui::extract_comfyui_metadata;
use crate::metadata::guidance::GuidanceClassifier;
use serde_json::json;
use std::collections::HashMap;

fn clean(name: &str) -> String {
    GuidanceClassifier::clean_name(name)
}

fn sorted(mut values: Vec<String>) -> Vec<String> {
    values.sort();
    values
}

/// Mirrors SeaArt-style workflows: loaders hold display names without file extensions, the
/// sampler's model arrives through a persisted Use Everywhere link whose temporary link id
/// still sits on the input, and VAE / IP-Adapter loaders sit nearby as global-scan decoys.
#[test]
fn ui_workflow_with_extensionless_loader_names_resolves_through_use_everywhere() {
    let workflow = json!({
        "nodes": [
            {
                "id": 1, "type": "CheckpointLoaderSimple", "mode": 0, "inputs": [],
                "outputs": [{ "name": "MODEL", "type": "MODEL", "links": [1] }],
                "widgets_values": ["WAI-NSFW-illustrious-SDXL-v10.0"]
            },
            {
                "id": 2, "type": "LoraLoaderModelOnly", "mode": 0,
                "inputs": [{ "name": "model", "type": "MODEL", "link": 1 }],
                "outputs": [{ "name": "MODEL", "type": "MODEL", "links": [2] }],
                "widgets_values": ["Frostbite | Artstyle-Illustrious", 1.0000000000000002]
            },
            {
                "id": 3, "type": "LoraLoaderModelOnly", "mode": 4,
                "inputs": [{ "name": "model", "type": "MODEL", "link": 2 }],
                "outputs": [{ "name": "MODEL", "type": "MODEL", "links": [3] }],
                "widgets_values": ["Bypassed Style", 0.7]
            },
            {
                "id": 4, "type": "LoraLoaderModelOnly", "mode": 0,
                "inputs": [{ "name": "model", "type": "MODEL", "link": 3 }],
                "outputs": [{ "name": "MODEL", "type": "MODEL", "links": [4] }],
                "widgets_values": ["MoriiMee Gothic Niji | LoRA Style-V1 Ilustrious", 0.5000000000000001]
            },
            {
                "id": 10, "type": "Anything Everywhere3", "mode": 0,
                "inputs": [{ "name": "anything", "type": "*", "link": 4 }],
                "outputs": []
            },
            {
                "id": 20, "type": "VAELoader", "mode": 0, "inputs": [],
                "outputs": [{ "name": "VAE", "type": "VAE", "links": [] }],
                "widgets_values": ["sdxl_vae.safetensors"]
            },
            {
                "id": 21, "type": "IPAdapterModelLoader", "mode": 0, "inputs": [],
                "outputs": [{ "name": "IPADAPTER", "type": "IPADAPTER", "links": [] }],
                "widgets_values": ["noobIPAMARK1_mark1.safetensors"]
            },
            {
                "id": 30, "type": "KSampler", "mode": 0,
                "inputs": [
                    { "name": "model", "type": "MODEL", "link": 7189 },
                    { "name": "positive", "type": "CONDITIONING", "link": 40 },
                    { "name": "negative", "type": "CONDITIONING", "link": 41 }
                ],
                "outputs": [{ "name": "LATENT", "type": "LATENT", "links": [20] }],
                "widgets_values": [117113267189006_i64, "fixed", 28, 6.5, "dpmpp_2m", "karras", 1]
            },
            {
                "id": 40, "type": "CLIPTextEncode", "mode": 0, "inputs": [],
                "outputs": [{ "name": "CONDITIONING", "type": "CONDITIONING", "links": [40] }],
                "widgets_values": ["masterpiece, a castle at dusk"]
            },
            {
                "id": 41, "type": "CLIPTextEncode", "mode": 0, "inputs": [],
                "outputs": [{ "name": "CONDITIONING", "type": "CONDITIONING", "links": [41] }],
                "widgets_values": ["lowres, worst quality"]
            },
            {
                "id": 31, "type": "VAEDecode", "mode": 0,
                "inputs": [{ "name": "samples", "type": "LATENT", "link": 20 }],
                "outputs": [{ "name": "IMAGE", "type": "IMAGE", "links": [21] }]
            },
            {
                "id": 32, "type": "SaveImage", "mode": 0,
                "inputs": [{ "name": "images", "type": "IMAGE", "link": 21 }],
                "outputs": []
            }
        ],
        "links": [
            [1, 1, 0, 2, 0, "MODEL"],
            [2, 2, 0, 3, 0, "MODEL"],
            [3, 3, 0, 4, 0, "MODEL"],
            [4, 4, 0, 10, 0, "MODEL"],
            [40, 40, 0, 30, 1, "CONDITIONING"],
            [41, 41, 0, 30, 2, "CONDITIONING"],
            [20, 30, 0, 31, 0, "LATENT"],
            [21, 31, 0, 32, 0, "IMAGE"]
        ],
        "extra": {
            "ue_links": [{
                "downstream": 30, "downstream_slot": 0,
                "upstream": "4", "upstream_slot": 0,
                "controller": 10, "type": "MODEL"
            }],
            "links_added_by_ue": [7189]
        }
    });
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.model, clean("WAI-NSFW-illustrious-SDXL-v10.0"));
    assert_eq!(meta.steps, 28);
    assert_eq!(meta.cfg, 6.5);
    assert_eq!(meta.sampler, "dpmpp_2m (karras)");

    let frostbite = clean("Frostbite | Artstyle-Illustrious");
    let moriimee = clean("MoriiMee Gothic Niji | LoRA Style-V1 Ilustrious");
    assert_eq!(sorted(meta.loras.clone()), sorted(vec![frostbite.clone(), moriimee.clone()]));
    assert!(meta.loras.iter().all(|lora| !lora.contains('(')), "ComfyUI LoRA names stay weightless");
    assert!((meta.lora_weights[&frostbite] - 1.0).abs() < 1e-6);
    assert!((meta.lora_weights[&moriimee] - 0.5).abs() < 1e-6);
    assert_eq!(meta.lora_weights.len(), 2, "bypassed LoRAs carry no weight");
}

/// Civitai's on-site generator writes internal `EMS-…` file names plus readable `tams_*` names.
#[test]
fn civitai_prompt_prefers_readable_model_and_lora_names() {
    let prompt = json!({
        "1": { "class_type": "CheckpointLoaderSimple", "inputs": {
            "ckpt_name": "EMS-726900-EMS.safetensors",
            "tams_ckpt_name": "WAI-illustrious - v10",
            "_base_model": "Illustrious"
        } },
        "2": { "class_type": "LoraLoaderModelOnly", "inputs": {
            "lora_name": "EMS-576580-EMS.safetensors",
            "tams_lora_name": "Frostbite | Artstyle - Illustrious",
            "strength_model": 0.8,
            "model": ["1", 0]
        } },
        "3": { "class_type": "KSampler", "inputs": {
            "model": ["2", 0], "seed": 1, "steps": 28, "cfg": 6.5,
            "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1,
            "positive": ["4", 0], "negative": ["5", 0], "latent_image": ["6", 0]
        } },
        "4": { "class_type": "CLIPTextEncode", "inputs": { "text": "a castle", "clip": ["1", 1] } },
        "5": { "class_type": "CLIPTextEncode", "inputs": { "text": "lowres", "clip": ["1", 1] } },
        "6": { "class_type": "EmptyLatentImage", "inputs": { "width": 1024, "height": 1024, "batch_size": 1 } },
        "7": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["1", 2] } },
        "8": { "class_type": "SaveImage", "inputs": { "images": ["7", 0] } }
    });
    let chunks = HashMap::from([("prompt".to_string(), prompt.to_string())]);

    let meta = extract_comfyui_metadata(&chunks);

    let frostbite = clean("Frostbite | Artstyle - Illustrious");
    assert_eq!(meta.model, clean("WAI-illustrious - v10"));
    assert_eq!(meta.loras, vec![frostbite.clone()]);
    assert!((meta.lora_weights[&frostbite] - 0.8).abs() < 1e-6);
}

#[test]
fn a_lora_loaded_at_two_strengths_gets_no_single_weight() {
    let prompt = json!({
        "1": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "base.safetensors" } },
        "2": { "class_type": "LoraLoaderModelOnly", "inputs": {
            "lora_name": "style.safetensors", "strength_model": 0.5, "model": ["1", 0]
        } },
        "3": { "class_type": "LoraLoaderModelOnly", "inputs": {
            "lora_name": "style.safetensors", "strength_model": 0.9, "model": ["2", 0]
        } },
        "4": { "class_type": "KSampler", "inputs": {
            "model": ["3", 0], "seed": 1, "steps": 20, "cfg": 7, "sampler_name": "euler",
            "scheduler": "normal", "denoise": 1, "positive": ["5", 0], "negative": ["5", 0],
            "latent_image": ["6", 0]
        } },
        "5": { "class_type": "CLIPTextEncode", "inputs": { "text": "a castle", "clip": ["1", 1] } },
        "6": { "class_type": "EmptyLatentImage", "inputs": { "width": 512, "height": 512, "batch_size": 1 } }
    });
    let chunks = HashMap::from([("prompt".to_string(), prompt.to_string())]);

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.loras, vec!["style".to_string()]);
    assert!(meta.lora_weights.is_empty());
}
