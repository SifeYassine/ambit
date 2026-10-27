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

fn ip_adapter_workflow(apply_mode: i64) -> HashMap<String, String> {
    let workflow = json!({
        "nodes": [
            {
                "id": 1, "type": "CheckpointLoaderSimple", "mode": 0, "inputs": [],
                "outputs": [{ "name": "MODEL", "type": "MODEL", "links": [1] }],
                "widgets_values": ["WAI-illustrious-SDXL-v10.0"]
            },
            {
                "id": 2, "type": "IPAdapterModelLoader", "mode": 0, "inputs": [],
                "outputs": [{ "name": "IPADAPTER", "type": "IPADAPTER", "links": [2] }],
                "widgets_values": ["noobIPAMARK1_mark1.safetensors"]
            },
            {
                "id": 3, "type": "IPAdapterAdvanced", "mode": apply_mode,
                "inputs": [
                    { "name": "model", "type": "MODEL", "link": 1 },
                    { "name": "ipadapter", "type": "IPADAPTER", "link": 2 }
                ],
                "outputs": [{ "name": "MODEL", "type": "MODEL", "links": [3] }],
                "widgets_values": [0.4000000000000001, "linear", "concat", 0, 1, "V only"]
            },
            {
                "id": 4, "type": "KSampler", "mode": 0,
                "inputs": [
                    { "name": "model", "type": "MODEL", "link": 3 },
                    { "name": "positive", "type": "CONDITIONING", "link": 40 },
                    { "name": "negative", "type": "CONDITIONING", "link": 41 }
                ],
                "outputs": [{ "name": "LATENT", "type": "LATENT", "links": [] }],
                "widgets_values": [7, "fixed", 29, 3.5, "dpmpp_2m", "karras", 1]
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
            }
        ],
        "links": [
            [1, 1, 0, 3, 0, "MODEL"],
            [2, 2, 0, 3, 1, "IPADAPTER"],
            [3, 3, 0, 4, 0, "MODEL"],
            [40, 40, 0, 4, 1, "CONDITIONING"],
            [41, 41, 0, 4, 2, "CONDITIONING"]
        ]
    });
    HashMap::from([("workflow".to_string(), workflow.to_string())])
}

/// Current IPAdapter_plus nodes (IPAdapterAdvanced and friends) replaced the legacy IPAdapterApply.
#[test]
fn ip_adapter_advanced_records_its_adapter_and_passes_the_model_through() {
    let meta = extract_comfyui_metadata(&ip_adapter_workflow(0));

    assert_eq!(meta.model, clean("WAI-illustrious-SDXL-v10.0"));
    assert_eq!(meta.ip_adapters, vec![clean("noobIPAMARK1_mark1.safetensors")]);
    let weight = meta.ip_adapter_weights[&clean("noobIPAMARK1_mark1.safetensors")];
    assert!((weight - 0.4).abs() < 1e-6, "{weight}");
}

#[test]
fn a_bypassed_ip_adapter_is_not_recorded() {
    let meta = extract_comfyui_metadata(&ip_adapter_workflow(4));

    assert!(meta.ip_adapters.is_empty(), "{:?}", meta.ip_adapters);
    assert!(meta.ip_adapter_weights.is_empty());
}

/// ControlNetApplyAdvanced keeps its strength as the first widget: [strength, start, end].
#[test]
fn ui_workflow_controlnet_strength_comes_from_the_apply_node() {
    let workflow = json!({
        "nodes": [
            {
                "id": 1, "type": "CheckpointLoaderSimple", "mode": 0, "inputs": [],
                "outputs": [{ "name": "MODEL", "type": "MODEL", "links": [1] }],
                "widgets_values": ["WAI-illustrious-SDXL-v10.0"]
            },
            {
                "id": 2, "type": "ControlNetLoader", "mode": 0, "inputs": [],
                "outputs": [{ "name": "CONTROL_NET", "type": "CONTROL_NET", "links": [2] }],
                "widgets_values": ["control_v11p_sd15_openpose.pth"]
            },
            {
                "id": 3, "type": "ControlNetApplyAdvanced", "mode": 0,
                "inputs": [
                    { "name": "positive", "type": "CONDITIONING", "link": 40 },
                    { "name": "negative", "type": "CONDITIONING", "link": 41 },
                    { "name": "control_net", "type": "CONTROL_NET", "link": 2 }
                ],
                "outputs": [
                    { "name": "positive", "type": "CONDITIONING", "links": [30] },
                    { "name": "negative", "type": "CONDITIONING", "links": [31] }
                ],
                "widgets_values": [0.65, 0, 1]
            },
            {
                "id": 4, "type": "KSampler", "mode": 0,
                "inputs": [
                    { "name": "model", "type": "MODEL", "link": 1 },
                    { "name": "positive", "type": "CONDITIONING", "link": 30 },
                    { "name": "negative", "type": "CONDITIONING", "link": 31 }
                ],
                "outputs": [{ "name": "LATENT", "type": "LATENT", "links": [] }],
                "widgets_values": [7, "fixed", 29, 3.5, "dpmpp_2m", "karras", 1]
            },
            {
                "id": 40, "type": "CLIPTextEncode", "mode": 0, "inputs": [],
                "outputs": [{ "name": "CONDITIONING", "type": "CONDITIONING", "links": [40] }],
                "widgets_values": ["masterpiece, a dancer"]
            },
            {
                "id": 41, "type": "CLIPTextEncode", "mode": 0, "inputs": [],
                "outputs": [{ "name": "CONDITIONING", "type": "CONDITIONING", "links": [41] }],
                "widgets_values": ["lowres"]
            }
        ],
        "links": [
            [1, 1, 0, 4, 0, "MODEL"],
            [2, 2, 0, 3, 2, "CONTROL_NET"],
            [30, 3, 0, 4, 1, "CONDITIONING"],
            [31, 3, 1, 4, 2, "CONDITIONING"],
            [40, 40, 0, 3, 0, "CONDITIONING"],
            [41, 41, 0, 3, 1, "CONDITIONING"]
        ]
    });
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let meta = extract_comfyui_metadata(&chunks);

    let name = clean("control_v11p_sd15_openpose.pth");
    assert_eq!(meta.control_nets, vec![name.clone()]);
    assert!((meta.control_net_weights[&name] - 0.65).abs() < 1e-6, "{:?}", meta.control_net_weights);
}

fn controlnet_prompt(second_strength: Option<f64>) -> HashMap<String, String> {
    let mut prompt = json!({
        "1": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "base.safetensors" } },
        "5": { "class_type": "CLIPTextEncode", "inputs": { "text": "a dancer", "clip": ["1", 1] } },
        "6": { "class_type": "CLIPTextEncode", "inputs": { "text": "lowres", "clip": ["1", 1] } },
        "7": { "class_type": "ControlNetLoader", "inputs": { "control_net_name": "control_v11p_sd15_canny.pth" } },
        "8": { "class_type": "LoadImage", "inputs": { "image": "edges.png" } },
        "9": { "class_type": "ControlNetApplyAdvanced", "inputs": {
            "positive": ["5", 0], "negative": ["6", 0], "control_net": ["7", 0], "image": ["8", 0],
            "strength": 0.8, "start_percent": 0, "end_percent": 1
        } },
        "4": { "class_type": "KSampler", "inputs": {
            "model": ["1", 0], "seed": 1, "steps": 20, "cfg": 7, "sampler_name": "euler",
            "scheduler": "normal", "denoise": 1, "positive": ["9", 0], "negative": ["9", 1],
            "latent_image": ["3", 0]
        } },
        "3": { "class_type": "EmptyLatentImage", "inputs": { "width": 512, "height": 512, "batch_size": 1 } }
    });
    if let Some(strength) = second_strength {
        prompt["10"] = json!({ "class_type": "ControlNetApplyAdvanced", "inputs": {
            "positive": ["9", 0], "negative": ["9", 1], "control_net": ["7", 0], "image": ["8", 0],
            "strength": strength, "start_percent": 0, "end_percent": 1
        } });
        prompt["4"]["inputs"]["positive"] = json!(["10", 0]);
        prompt["4"]["inputs"]["negative"] = json!(["10", 1]);
    }
    HashMap::from([("prompt".to_string(), prompt.to_string())])
}

#[test]
fn api_prompt_controlnet_strength_is_read_from_inputs() {
    let meta = extract_comfyui_metadata(&controlnet_prompt(None));

    let name = clean("control_v11p_sd15_canny.pth");
    assert_eq!(meta.control_nets, vec![name.clone()]);
    assert!((meta.control_net_weights[&name] - 0.8).abs() < 1e-6, "{:?}", meta.control_net_weights);
}

#[test]
fn a_controlnet_applied_at_two_strengths_gets_no_single_weight() {
    let agreeing = extract_comfyui_metadata(&controlnet_prompt(Some(0.8)));
    assert_eq!(agreeing.control_net_weights.len(), 1);

    let conflicting = extract_comfyui_metadata(&controlnet_prompt(Some(0.3)));
    assert_eq!(conflicting.control_nets, vec![clean("control_v11p_sd15_canny.pth")]);
    assert!(conflicting.control_net_weights.is_empty(), "{:?}", conflicting.control_net_weights);
}

/// Supporting models count only when their loader is active and an active node consumes it.
#[test]
fn workflow_supporting_models_come_from_active_consumed_loaders() {
    let node = |id: i64, node_type: &str, mode: i64, inputs: serde_json::Value, links: Vec<i64>, widgets: serde_json::Value| json!({
        "id": id, "type": node_type, "mode": mode, "inputs": inputs,
        "outputs": [{ "name": "OUT", "type": "*", "links": links }],
        "widgets_values": widgets
    });
    let workflow = json!({
        "nodes": [
            node(1, "CheckpointLoaderSimple", 0, json!([]), vec![1], json!(["WAI-illustrious-SDXL-v10.0"])),
            node(2, "VAELoader", 0, json!([]), vec![2], json!(["sdxl_vae.safetensors"])),
            node(3, "VAELoader", 0, json!([]), vec![], json!(["unused_vae.safetensors"])),
            node(4, "UpscaleModelLoader", 0, json!([]), vec![4], json!(["4x-UltraSharp.pth"])),
            node(5, "UpscaleModelLoader", 4, json!([]), vec![5], json!(["4x-AnimeSharp.pth"])),
            node(6, "UltralyticsDetectorProvider", 0, json!([]), vec![6], json!(["bbox/face_yolov8m.pt"])),
            node(7, "SAMLoader", 0, json!([]), vec![7], json!(["sam_vit_b_01ec64.pth", "AUTO"])),
            node(8, "CLIPVisionLoader", 0, json!([]), vec![8], json!(["CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors"])),
            node(20, "KSampler", 0, json!([
                { "name": "model", "type": "MODEL", "link": 1 },
                { "name": "positive", "type": "CONDITIONING", "link": 40 },
                { "name": "negative", "type": "CONDITIONING", "link": 41 }
            ]), vec![20], json!([7, "fixed", 28, 6.5, "euler", "normal", 1])),
            node(21, "VAEDecode", 0, json!([
                { "name": "samples", "type": "LATENT", "link": 20 },
                { "name": "vae", "type": "VAE", "link": 2 }
            ]), vec![21], json!([])),
            node(22, "ImageUpscaleWithModel", 0, json!([
                { "name": "upscale_model", "type": "UPSCALE_MODEL", "link": 4 },
                { "name": "image", "type": "IMAGE", "link": 21 }
            ]), vec![22], json!([])),
            node(23, "ImageUpscaleWithModel", 0, json!([
                { "name": "upscale_model", "type": "UPSCALE_MODEL", "link": 5 }
            ]), vec![], json!([])),
            node(24, "FaceDetailer", 0, json!([
                { "name": "image", "type": "IMAGE", "link": 22 },
                { "name": "bbox_detector", "type": "BBOX_DETECTOR", "link": 6 },
                { "name": "sam_model_opt", "type": "SAM_MODEL", "link": 7 }
            ]), vec![], json!([])),
            node(25, "IPAdapterAdvanced", 4, json!([
                { "name": "clip_vision", "type": "CLIP_VISION", "link": 8 }
            ]), vec![], json!([])),
            node(40, "CLIPTextEncode", 0, json!([]), vec![40], json!(["a castle at dusk"])),
            node(41, "CLIPTextEncode", 0, json!([]), vec![41], json!(["lowres"]))
        ],
        "links": [
            [1, 1, 0, 20, 0, "MODEL"], [40, 40, 0, 20, 1, "CONDITIONING"], [41, 41, 0, 20, 2, "CONDITIONING"],
            [2, 2, 0, 21, 1, "VAE"], [20, 20, 0, 21, 0, "LATENT"],
            [4, 4, 0, 22, 0, "UPSCALE_MODEL"], [21, 21, 0, 22, 1, "IMAGE"],
            [5, 5, 0, 23, 0, "UPSCALE_MODEL"],
            [22, 22, 0, 24, 0, "IMAGE"], [6, 6, 0, 24, 1, "BBOX_DETECTOR"], [7, 7, 0, 24, 2, "SAM_MODEL"],
            [8, 8, 0, 25, 0, "CLIP_VISION"]
        ]
    });
    let meta = extract_comfyui_metadata(&HashMap::from([("workflow".to_string(), workflow.to_string())]));

    assert_eq!(meta.vaes, vec![clean("sdxl_vae.safetensors")], "unused VAE loader is ignored");
    assert_eq!(meta.upscalers, vec![clean("4x-UltraSharp.pth")], "bypassed upscaler is ignored");
    assert_eq!(meta.detectors, vec![clean("bbox/face_yolov8m.pt"), clean("sam_vit_b_01ec64.pth")]);
    assert!(meta.clip_visions.is_empty(), "a CLIP Vision feeding only a bypassed IP-Adapter is ignored");
}

#[test]
fn api_prompt_supporting_models_are_read_from_inputs() {
    let prompt = json!({
        "1": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "base.safetensors" } },
        "2": { "class_type": "VAELoader", "inputs": { "vae_name": "ae.sft" } },
        "3": { "class_type": "CLIPVisionLoader", "inputs": { "clip_name": "clip_vision_h.safetensors" } },
        "4": { "class_type": "KSampler", "inputs": {
            "model": ["1", 0], "seed": 1, "steps": 20, "cfg": 7, "sampler_name": "euler",
            "scheduler": "normal", "denoise": 1, "positive": ["6", 0], "negative": ["6", 0], "latent_image": ["7", 0]
        } },
        "5": { "class_type": "VAEDecode", "inputs": { "samples": ["4", 0], "vae": ["2", 0] } },
        "6": { "class_type": "CLIPTextEncode", "inputs": { "text": "a castle", "clip": ["1", 1] } },
        "7": { "class_type": "EmptyLatentImage", "inputs": { "width": 512, "height": 512, "batch_size": 1 } },
        "8": { "class_type": "CLIPVisionEncode", "inputs": { "clip_vision": ["3", 0] } }
    });
    let meta = extract_comfyui_metadata(&HashMap::from([("prompt".to_string(), prompt.to_string())]));

    assert_eq!(meta.vaes, vec![clean("ae.sft")]);
    assert_eq!(meta.clip_visions, vec![clean("clip_vision_h.safetensors")]);
}
