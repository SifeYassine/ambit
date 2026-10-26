//! Supporting models a workflow loads beside its checkpoint: VAEs, upscale models, CLIP Vision
//! encoders, and detection / segmentation models. A loader counts only when it is active and an
//! active node consumes its output, so bypassed or disconnected groups add nothing.

use super::graph::{get_node_param, get_node_type, ComfyGraph};
use crate::metadata::guidance::GuidanceClassifier;
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug, Default, PartialEq)]
pub(crate) struct AuxiliaryResources {
    pub vaes: Vec<String>,
    pub upscalers: Vec<String>,
    pub clip_visions: Vec<String>,
    pub detectors: Vec<String>,
}

#[derive(Clone, Copy)]
enum ResourceKind {
    Vae,
    Upscaler,
    ClipVision,
    Detector,
}

/// Loader node types and the input holding their model file.
fn loader_kind(node_type: &str) -> Option<(ResourceKind, &'static str)> {
    match node_type {
        "VAELoader" => Some((ResourceKind::Vae, "vae_name")),
        "UpscaleModelLoader" => Some((ResourceKind::Upscaler, "model_name")),
        "CLIPVisionLoader" => Some((ResourceKind::ClipVision, "clip_name")),
        "UltralyticsDetectorProvider" | "ONNXDetectorProvider" | "SAMLoader" => {
            Some((ResourceKind::Detector, "model_name"))
        }
        _ => None,
    }
}

fn is_active(node: &Value) -> bool {
    !matches!(node.get("mode").and_then(Value::as_i64), Some(2 | 4))
}

fn push_id(ids: &mut HashSet<String>, value: &Value) {
    match value {
        Value::String(id) => {
            ids.insert(id.clone());
        }
        Value::Number(id) => {
            ids.insert(id.to_string());
        }
        Value::Object(object) => {
            if let Some(id) = object.get("node_id") {
                push_id(ids, id);
            }
        }
        _ => {}
    }
}

/// Every node id that an active node reads from, across API prompts (`[id, slot]` inputs) and
/// normalized UI workflows (`_resolved_sources` / `_resolved_inputs`).
fn consumed_source_ids(graph: &ComfyGraph) -> HashSet<String> {
    let mut ids = HashSet::new();
    for node in graph.nodes().values().filter(|node| is_active(node)) {
        if let Some(inputs) = node.get("inputs").and_then(Value::as_object) {
            for value in inputs.values() {
                if let Some(source) = value.as_array().filter(|link| link.len() == 2).and_then(|link| link.first()) {
                    push_id(&mut ids, source);
                }
            }
        }
        for key in ["_resolved_sources", "_resolved_inputs"] {
            let Some(sources) = node.get(key).and_then(Value::as_object) else {
                continue;
            };
            for value in sources.values() {
                match value {
                    Value::Array(entries) => entries.iter().for_each(|entry| push_id(&mut ids, entry)),
                    other => push_id(&mut ids, other),
                }
            }
        }
    }
    ids
}

pub(crate) fn collect_auxiliary_resources(graph: &ComfyGraph) -> AuxiliaryResources {
    let consumed = consumed_source_ids(graph);
    let mut node_ids: Vec<&String> = graph.nodes().keys().collect();
    node_ids.sort_by(|left, right| super::graph::compare_node_ids(left, right));

    let mut resources = AuxiliaryResources::default();
    for node_id in node_ids {
        let node = &graph.nodes()[node_id];
        let Some((kind, input)) = loader_kind(get_node_type(node)) else {
            continue;
        };
        if !is_active(node) || !consumed.contains(node_id) {
            continue;
        }
        let Some(name) = get_node_param(node, input)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty() && *name != "None")
        else {
            continue;
        };
        let name = GuidanceClassifier::clean_name(name);
        let target = match kind {
            ResourceKind::Vae => &mut resources.vaes,
            ResourceKind::Upscaler => &mut resources.upscalers,
            ResourceKind::ClipVision => &mut resources.clip_visions,
            ResourceKind::Detector => &mut resources.detectors,
        };
        if !name.is_empty() && !target.contains(&name) {
            target.push(name);
        }
    }
    resources
}
