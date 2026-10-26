use super::run_blocking;
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

const UNKNOWN: &str = "Unknown";
const LORA_FILE_EXTENSIONS: [&str; 5] = [".safetensors", ".ckpt", ".pt", ".bin", ".pth"];
const KEY_FIELD_SEPARATOR: char = '\u{1f}';
const KEY_ENTRY_SEPARATOR: char = '\u{1e}';

#[derive(Debug, Clone, PartialEq)]
struct PresetLora {
    name: String,
    weight: f64,
}

impl PresetLora {
    fn key_name(&self) -> String {
        self.name.to_lowercase()
    }

    /// Two decimals, so 0.8 and 0.80 are the same weight.
    fn weight_label(&self) -> String {
        let label = format!("{:.2}", self.weight);
        if label == "-0.00" {
            "0.00".to_string()
        } else {
            label
        }
    }

    /// Matches the parsers' display format: a weight of 1.0 is left implicit.
    fn display(&self) -> String {
        if self.weight_label() == "1.00" {
            self.name.clone()
        } else {
            format!("{} ({})", self.name, self.weight_label())
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
struct PresetSignature {
    strict_key: String,
    loose_key: String,
    model: String,
    sampler: String,
    loras_strict: Vec<String>,
    loras_loose: Vec<String>,
}

fn strip_lora_extension(name: &str) -> &str {
    let lower = name.to_lowercase();
    LORA_FILE_EXTENSIONS
        .iter()
        .find(|extension| lower.ends_with(*extension))
        .map(|extension| &name[..name.len() - extension.len()])
        .unwrap_or(name)
}

fn parse_weight(text: &str) -> Option<f64> {
    text.trim().parse::<f64>().ok().filter(|weight| weight.is_finite())
}

/// Parses the stored LoRA strings: `name`, `name (0.80)`, or legacy `name:0.8`.
fn parse_lora_entry(raw: &str) -> Option<PresetLora> {
    let entry = raw.trim();
    if entry.is_empty() {
        return None;
    }

    let (name, weight) = match entry.rfind(" (") {
        Some(open) if entry.ends_with(')') => {
            match parse_weight(&entry[open + 2..entry.len() - 1]) {
                Some(weight) => (&entry[..open], weight),
                None => (entry, 1.0),
            }
        }
        _ => match entry.rfind(':') {
            Some(colon) => match parse_weight(&entry[colon + 1..]) {
                Some(weight) => (&entry[..colon], weight),
                None => (entry, 1.0),
            },
            None => (entry, 1.0),
        },
    };

    let name = strip_lora_extension(name.trim()).trim();
    if name.is_empty() {
        return None;
    }
    Some(PresetLora {
        name: name.to_string(),
        weight,
    })
}

fn normalize_label(value: Option<&str>) -> String {
    match value.map(str::trim) {
        Some(text) if !text.is_empty() && !text.eq_ignore_ascii_case(UNKNOWN) => text.to_string(),
        _ => UNKNOWN.to_string(),
    }
}

fn hash_key(parts: &str) -> String {
    hex::encode(&Sha256::digest(parts.as_bytes())[..16])
}

/// Builds the model + LoRA + sampler signature for one image. Images with neither
/// a known model nor any LoRA carry no generation settings and get no preset.
fn build_signature(
    model: Option<&str>,
    sampler: Option<&str>,
    loras: &[String],
) -> Option<PresetSignature> {
    let model = normalize_label(model);
    let sampler = normalize_label(sampler);

    let mut parsed: Vec<PresetLora> = loras.iter().filter_map(|raw| parse_lora_entry(raw)).collect();
    if model == UNKNOWN && parsed.is_empty() {
        return None;
    }
    parsed.sort_by(|left, right| {
        left.key_name()
            .cmp(&right.key_name())
            .then_with(|| left.weight.total_cmp(&right.weight))
    });
    parsed.dedup_by(|left, right| {
        left.key_name() == right.key_name() && left.weight_label() == right.weight_label()
    });

    let mut loose: Vec<&PresetLora> = Vec::with_capacity(parsed.len());
    for lora in &parsed {
        if loose.last().map(|previous| previous.key_name()) != Some(lora.key_name()) {
            loose.push(lora);
        }
    }

    let prefix = format!(
        "{}{KEY_FIELD_SEPARATOR}{}{KEY_FIELD_SEPARATOR}",
        model.to_lowercase(),
        sampler.to_lowercase()
    );
    let strict_entries: Vec<String> = parsed
        .iter()
        .map(|lora| format!("{}@{}", lora.key_name(), lora.weight_label()))
        .collect();
    let loose_entries: Vec<String> = loose.iter().map(|lora| lora.key_name()).collect();
    let separator = KEY_ENTRY_SEPARATOR.to_string();

    Some(PresetSignature {
        strict_key: hash_key(&(prefix.clone() + &strict_entries.join(&separator))),
        loose_key: hash_key(&(prefix + &loose_entries.join(&separator))),
        model,
        sampler,
        loras_strict: parsed.iter().map(PresetLora::display).collect(),
        loras_loose: loose.iter().map(|lora| lora.name.clone()).collect(),
    })
}

fn parse_lora_list(json: Option<&str>) -> Vec<String> {
    json.and_then(|text| serde_json::from_str::<Vec<serde_json::Value>>(text).ok())
        .map(|values| {
            values
                .into_iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn rebuild_generation_presets_inner(conn: &Connection) -> Result<u32, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM image_presets", [])
        .map_err(|e| e.to_string())?;

    let mut indexed = 0_u32;
    {
        let mut select = tx
            .prepare(
                "SELECT id, resolved_model_name, sampler,
                    CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.loras') END
                 FROM images
                 WHERE is_deleted = 0",
            )
            .map_err(|e| e.to_string())?;
        let mut insert = tx
            .prepare(
                "INSERT INTO image_presets (
                    image_id, strict_key, loose_key, preset_model, preset_sampler,
                    preset_loras_strict, preset_loras_loose
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(|e| e.to_string())?;

        let mut rows = select.query([]).map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let id: String = row.get(0).map_err(|e| e.to_string())?;
            let model: Option<String> = row.get(1).map_err(|e| e.to_string())?;
            let sampler: Option<String> = row.get(2).map_err(|e| e.to_string())?;
            let loras_json: Option<String> = row.get(3).map_err(|e| e.to_string())?;
            let loras = parse_lora_list(loras_json.as_deref());

            let Some(signature) = build_signature(model.as_deref(), sampler.as_deref(), &loras) else {
                continue;
            };
            insert
                .execute(params![
                    id,
                    signature.strict_key,
                    signature.loose_key,
                    signature.model,
                    signature.sampler,
                    serde_json::to_string(&signature.loras_strict).map_err(|e| e.to_string())?,
                    serde_json::to_string(&signature.loras_loose).map_err(|e| e.to_string())?,
                ])
                .map_err(|e| e.to_string())?;
            indexed += 1;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(indexed)
}

/// Recomputes every image's preset signature. Returns how many images have one.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn rebuild_generation_presets(app: AppHandle) -> Result<u32, String> {
    run_blocking(app, rebuild_generation_presets_inner).await
}

#[cfg(test)]
mod tests {
    use super::{build_signature, parse_lora_entry, parse_lora_list, rebuild_generation_presets_inner, PresetLora};
    use rusqlite::Connection;

    fn loras(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn parses_stored_lora_formats() {
        let lora = |name: &str, weight: f64| Some(PresetLora { name: name.to_string(), weight });
        assert_eq!(parse_lora_entry("Frostbite"), lora("Frostbite", 1.0));
        assert_eq!(parse_lora_entry("Frostbite (0.80)"), lora("Frostbite", 0.8));
        assert_eq!(parse_lora_entry("frostbite.safetensors (0.80)"), lora("frostbite", 0.8));
        assert_eq!(parse_lora_entry("legacy:0.6"), lora("legacy", 0.6));
        assert_eq!(parse_lora_entry("style (v2)"), lora("style (v2)", 1.0));
        assert_eq!(parse_lora_entry("style (v2) (0.50)"), lora("style (v2)", 0.5));
        assert_eq!(parse_lora_entry("C:/loras/detail"), lora("C:/loras/detail", 1.0));
        assert_eq!(parse_lora_entry("   "), None);
        assert_eq!(parse_lora_entry(".safetensors"), None);
    }

    #[test]
    fn groups_regardless_of_lora_order_case_and_extension() {
        let first = build_signature(Some("WAI"), Some("euler"), &loras(&["B (0.80)", "a"])).unwrap();
        let second = build_signature(Some("wai"), Some("Euler"), &loras(&["a.safetensors", "b (0.8)"])).unwrap();
        assert_eq!(first.strict_key, second.strict_key);
        assert_eq!(first.loose_key, second.loose_key);
        assert_eq!(first.loras_strict, vec!["a".to_string(), "B (0.80)".to_string()]);
    }

    #[test]
    fn strict_keys_separate_lora_weights_and_loose_keys_merge_them() {
        let strong = build_signature(Some("WAI"), Some("euler"), &loras(&["Frostbite (0.80)"])).unwrap();
        let weak = build_signature(Some("WAI"), Some("euler"), &loras(&["Frostbite (0.50)"])).unwrap();
        assert_ne!(strong.strict_key, weak.strict_key);
        assert_eq!(strong.loose_key, weak.loose_key);
        assert_eq!(strong.loras_loose, vec!["Frostbite".to_string()]);
    }

    #[test]
    fn model_sampler_and_lora_set_each_define_the_preset() {
        let base = build_signature(Some("WAI"), Some("euler"), &loras(&["a"])).unwrap();
        let other_model = build_signature(Some("Nova"), Some("euler"), &loras(&["a"])).unwrap();
        let other_sampler = build_signature(Some("WAI"), Some("dpmpp 2m"), &loras(&["a"])).unwrap();
        let extra_lora = build_signature(Some("WAI"), Some("euler"), &loras(&["a", "b"])).unwrap();
        for other in [&other_model, &other_sampler, &extra_lora] {
            assert_ne!(base.strict_key, other.strict_key);
            assert_ne!(base.loose_key, other.loose_key);
        }
    }

    #[test]
    fn duplicate_lora_entries_collapse_but_distinct_weights_stay_in_strict_mode() {
        let signature = build_signature(Some("WAI"), None, &loras(&["a (0.50)", "A (0.5)", "a (0.90)"])).unwrap();
        assert_eq!(signature.loras_strict, vec!["a (0.50)".to_string(), "a (0.90)".to_string()]);
        assert_eq!(signature.loras_loose, vec!["a".to_string()]);
        assert_eq!(signature.sampler, "Unknown");
    }

    #[test]
    fn skips_images_without_a_model_or_loras() {
        assert!(build_signature(None, Some("euler"), &[]).is_none());
        assert!(build_signature(Some("Unknown"), Some("euler"), &loras(&[" "])).is_none());
        assert!(build_signature(Some("unknown"), None, &loras(&["a"])).is_some());
    }

    #[test]
    fn ignores_non_string_or_malformed_lora_lists() {
        assert_eq!(parse_lora_list(Some(r#"["a", 3, null, "b (0.50)"]"#)), loras(&["a", "b (0.50)"]));
        assert!(parse_lora_list(Some("not json")).is_empty());
        assert!(parse_lora_list(None).is_empty());
    }

    #[test]
    fn rebuild_replaces_the_cache_and_skips_deleted_or_unparsed_images() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE images (
                id TEXT PRIMARY KEY, resolved_model_name TEXT, sampler TEXT,
                metadata_json TEXT, is_deleted INTEGER NOT NULL DEFAULT 0
            );",
        )
        .unwrap();
        conn.execute_batch(crate::db::migrations::m85_generation_presets::migration85().sql)
            .unwrap();
        conn.execute_batch(
            r#"
            INSERT INTO images VALUES ('one', 'WAI', 'euler', '{"loras":["a (0.80)"]}', 0);
            INSERT INTO images VALUES ('two', 'WAI', 'euler', '{"loras":["a (0.8)"]}', 0);
            INSERT INTO images VALUES ('three', 'WAI', 'euler', '{"loras":["a"]}', 0);
            INSERT INTO images VALUES ('deleted', 'WAI', 'euler', '{}', 1);
            INSERT INTO images VALUES ('photo', 'Unknown', NULL, '{}', 0);
            INSERT INTO images VALUES ('broken', 'Nova', 'euler', '{not json', 0);
            INSERT INTO image_presets VALUES ('stale', 'x', 'x', 'x', 'x', '[]', '[]');
            "#,
        )
        .unwrap();

        assert_eq!(rebuild_generation_presets_inner(&conn).unwrap(), 4);

        let count = |sql: &str| conn.query_row(sql, [], |row| row.get::<_, i64>(0)).unwrap();
        assert_eq!(count("SELECT COUNT(*) FROM image_presets WHERE image_id IN ('stale', 'deleted', 'photo')"), 0);
        assert_eq!(count("SELECT COUNT(DISTINCT strict_key) FROM image_presets WHERE preset_model = 'WAI'"), 2);
        assert_eq!(count("SELECT COUNT(DISTINCT loose_key) FROM image_presets WHERE preset_model = 'WAI'"), 1);
        let broken_loras: String = conn
            .query_row("SELECT preset_loras_strict FROM image_presets WHERE image_id = 'broken'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(broken_loras, "[]");
    }
}
