//! Strengths for ControlNets and IP-Adapters. Their loaders hold only the model file: the
//! strength lives on each active node that applies the loaded model. Like `loraWeights`, a model
//! gets a weight only when every node applying it agrees.

use super::conditioning::trace_controlnet_name_valid;
use super::diagnostics::{ComfyMetadataField, ComfyParseDiagnostics};
use super::graph::{get_node_param, get_node_type, get_reroute_source_id, get_source_id, ComfyGraph};
use crate::metadata::consistent_weights;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};

pub(crate) struct GuidanceWeights {
    pub control_nets: BTreeMap<String, f64>,
    pub ip_adapters: BTreeMap<String, f64>,
}

fn is_active(node: &Value) -> bool {
    !matches!(node.get("mode").and_then(Value::as_i64), Some(2 | 4))
}

/// The node behind an apply node's model input, through any reroutes.
fn trace_loader(graph: &ComfyGraph, node_id: &str, input: &str) -> Option<String> {
    let mut current = get_source_id(graph, node_id, input)?;
    for _ in 0..16 {
        let node = graph.get_node(&current)?;
        if !get_node_type(node).contains("Reroute") {
            return Some(current);
        }
        current = get_reroute_source_id(node)?;
    }
    None
}

/// The strength of every active apply node, keyed by the loader node it applies.
fn strengths_by_loader(graph: &ComfyGraph) -> HashMap<String, Vec<f64>> {
    let mut strengths: HashMap<String, Vec<f64>> = HashMap::new();
    for (id, node) in graph.nodes() {
        if !is_active(node) {
            continue;
        }
        let node_type = get_node_type(node);
        let (loader, key) = if node_type.starts_with("ControlNetApply") {
            let loader = get_source_id(graph, id, "control_net")
                .and_then(|source| trace_controlnet_name_valid(graph, &source))
                .map(|(_, loader_id)| loader_id);
            (loader, "strength")
        } else if node_type.starts_with("IPAdapter") && !node_type.contains("Loader") {
            (trace_loader(graph, id, "ipadapter"), "weight")
        } else {
            continue;
        };
        if let (Some(loader), Some(strength)) = (loader, get_node_param(node, key).and_then(Value::as_f64)) {
            strengths.entry(loader).or_default().push(strength);
        }
    }
    strengths
}

fn weights_for(
    strengths: &HashMap<String, Vec<f64>>,
    names: &[String],
    field: ComfyMetadataField,
    diagnostics: &ComfyParseDiagnostics,
) -> BTreeMap<String, f64> {
    let Some(sources) = diagnostics.resource_sources.get(&field) else {
        return BTreeMap::new();
    };
    consistent_weights(names.iter().flat_map(|name| {
        sources
            .get(name)
            .into_iter()
            .flat_map(|provenance| provenance.node_ids.iter())
            .filter_map(|loader_id| strengths.get(loader_id))
            .flatten()
            .map(move |strength| (name.clone(), *strength))
    }))
}

pub(crate) fn guidance_weights(
    graph: &ComfyGraph,
    control_nets: &[String],
    ip_adapters: &[String],
    diagnostics: &ComfyParseDiagnostics,
) -> GuidanceWeights {
    let strengths = strengths_by_loader(graph);
    GuidanceWeights {
        control_nets: weights_for(&strengths, control_nets, ComfyMetadataField::ControlNets, diagnostics),
        ip_adapters: weights_for(&strengths, ip_adapters, ComfyMetadataField::IpAdapters, diagnostics),
    }
}
