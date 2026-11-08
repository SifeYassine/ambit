//! Similarity search: CLIP embeddings for library images, searched by text, by a
//! library image, or by an image file. Ported from SmartSim; the model is downloaded
//! on request into app-local data and everything else runs locally.

mod clip;
mod cluster;

use crate::db::commands::run_blocking;
use crate::db::ProgressPayload;
use clip::{ClipEngine, EMBEDDING_DIM};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Stored with each embedding so a future model change can re-index cleanly. The ONNX
/// export produces the same vectors as the original weights, so it keeps this id.
pub const MODEL_ID: &str = "clip-vit-base-patch16";
const MODEL_DIR: &str = "clip-vit-base-patch16";
const RUNTIME_FILE: &str = "onnxruntime.dll";
const VISION_FILE: &str = "vision_model.onnx";
const TEXT_FILE: &str = "text_model.onnx";
const TOKENIZER_FILE: &str = "tokenizer.json";
const RUNTIME_REMOVAL_MARKER: &str = "remove-runtime.pending";
/// Weights used by the earlier candle engine; removed once the ONNX files are installed.
const LEGACY_FILES: [&str; 1] = ["model.safetensors"];
const INDEX_BATCH_SIZE: usize = 16;
const IMAGE_EXTENSIONS: [&str; 8] = ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff"];

/// One pinned download. `sha256` and `download_size` describe the downloaded bytes; for
/// an archive, `extract` names the member that is installed as `name`.
struct ModelFile {
    name: &'static str,
    url: &'static str,
    download_size: u64,
    sha256: &'static str,
    installed_size: u64,
    extract: Option<&'static str>,
}

const MODEL_FILES: [ModelFile; 4] = [
    // OpenAI's tokenizer at the commit SmartSim loads (refs/pr/17 of the original repo).
    ModelFile {
        name: TOKENIZER_FILE,
        url: "https://huggingface.co/openai/clip-vit-base-patch16/resolve/5ef227a78de3f75873f373246dac80def63b0003/tokenizer.json",
        download_size: 2_224_003,
        sha256: "a83e0809aa4c3af7208b2df632a7a69668c6d48775b3c3fe4e1b1199d1f8b8f4",
        installed_size: 2_224_003,
        extract: None,
    },
    // ONNX Runtime 1.28.3 CPU build, the version `ort` 2.0.0-rc.13 targets.
    ModelFile {
        name: RUNTIME_FILE,
        url: "https://github.com/microsoft/onnxruntime/releases/download/v1.28.3/onnxruntime-win-x64-1.28.3.zip",
        download_size: 78_606_946,
        sha256: "1d6fab48e85f948436af7c8c971d2c145cf224e2c444755dec894f8b0de11a83",
        installed_size: 15_828_832,
        extract: Some("onnxruntime-win-x64-1.28.3/lib/onnxruntime.dll"),
    },
    // Xenova's fp32 ONNX export of openai/clip-vit-base-patch16.
    ModelFile {
        name: TEXT_FILE,
        url: "https://huggingface.co/Xenova/clip-vit-base-patch16/resolve/342fdf2f67aded64d138ff074745fb4a5d2bba5f/onnx/text_model.onnx",
        download_size: 254_058_553,
        sha256: "19f40c7988af119fc50dabfe8015da8595c0372000e2c1f1a6289e35930577aa",
        installed_size: 254_058_553,
        extract: None,
    },
    ModelFile {
        name: VISION_FILE,
        url: "https://huggingface.co/Xenova/clip-vit-base-patch16/resolve/342fdf2f67aded64d138ff074745fb4a5d2bba5f/onnx/vision_model.onnx",
        download_size: 345_060_583,
        sha256: "b5170b47c0ecc667c9af5b42ed460c341377706d1466d177798c65fe49ea1e6b",
        installed_size: 345_060_583,
        extract: None,
    },
];

fn is_file_installed(dir: &Path, file: &ModelFile) -> bool {
    std::fs::metadata(dir.join(file.name))
        .map(|meta| meta.len() == file.installed_size)
        .unwrap_or(false)
}

#[derive(Default)]
pub struct SimilarityState {
    engine: Mutex<Option<Arc<ClipEngine>>>,
    downloading: AtomicBool,
    download_cancelled: AtomicBool,
    indexing: AtomicBool,
    index_cancelled: AtomicBool,
}

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SimilarityStatus {
    pub model_installed: bool,
    pub model_downloading: bool,
    pub indexing: bool,
    /// Download size in bytes (a float so it is a plain number in TypeScript).
    pub model_size_bytes: f64,
    pub indexed_count: u32,
    pub pending_count: u32,
}

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SimilarityIndexResult {
    pub indexed: u32,
    pub failed: u32,
    pub remaining: u32,
    pub was_cancelled: bool,
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimilarityMatch {
    pub image_id: String,
    pub similarity: f32,
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SimilarityQuery {
    Text { text: String },
    #[serde(rename_all = "camelCase")]
    LibraryImage { image_id: String },
    File { path: String },
}

/// SmartSim's clustering parameters; every field is optional.
#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ClusterOptions {
    pub max_clusters: Option<u32>,
    pub similarity_threshold: Option<f32>,
    pub min_images: Option<u32>,
    pub max_images: Option<u32>,
}

/// The full distance matrix grows with the square of the image count.
const MAX_CLUSTER_IMAGES: usize = 20_000;

// ---------------------------------------------------------------------------
// Model files

fn model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("models")
        .join(MODEL_DIR))
}

fn is_model_installed(dir: &Path) -> bool {
    MODEL_FILES.iter().all(|file| is_file_installed(dir, file))
}

/// Bytes still to download, so the page states the real size (an upgrade from the candle
/// engine already has the tokenizer).
fn remaining_download_size(dir: &Path) -> u64 {
    MODEL_FILES
        .iter()
        .filter(|file| !is_file_installed(dir, file))
        .map(|file| file.download_size)
        .sum()
}

fn extract_member(archive: &Path, member: &str, destination: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("Unreadable runtime archive: {e}"))?;
    let mut entry = zip
        .by_name(member)
        .map_err(|e| format!("The runtime archive has no {member}: {e}"))?;
    let partial = destination.with_extension("part");
    let mut output = std::fs::File::create(&partial).map_err(|e| e.to_string())?;
    std::io::copy(&mut entry, &mut output).map_err(|e| e.to_string())?;
    drop(output);
    std::fs::rename(&partial, destination).map_err(|e| e.to_string())
}

fn engine(app: &AppHandle) -> Result<Arc<ClipEngine>, String> {
    let state = app.state::<SimilarityState>();
    let mut slot = state.engine.lock().map_err(|e| e.to_string())?;
    if let Some(engine) = slot.as_ref() {
        return Ok(engine.clone());
    }
    let dir = model_dir(app)?;
    if !is_model_installed(&dir) {
        return Err("The similarity model is not downloaded yet".to_string());
    }
    log::info!("[Similarity] Loading CLIP model");
    let loaded = Arc::new(ClipEngine::load(
        &dir.join(RUNTIME_FILE),
        &dir.join(VISION_FILE),
        &dir.join(TEXT_FILE),
        &dir.join(TOKENIZER_FILE),
    )?);
    *slot = Some(loaded.clone());
    Ok(loaded)
}

async fn download_file(
    app: &AppHandle,
    client: &reqwest::Client,
    dir: &Path,
    file: &ModelFile,
    downloaded_before: u64,
    total: u64,
) -> Result<(), String> {
    let state = app.state::<SimilarityState>();
    let mut response = client
        .get(file.url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Download failed: {e}"))?;

    let partial = dir.join(format!("{}.part", file.name));
    let mut output = std::fs::File::create(&partial).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut last_emit = Instant::now();

    let result: Result<(), String> = async {
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| format!("Download interrupted: {e}"))?
        {
            if state.download_cancelled.load(Ordering::SeqCst) {
                return Err("Download cancelled".to_string());
            }
            output.write_all(&chunk).map_err(|e| e.to_string())?;
            hasher.update(&chunk);
            received += chunk.len() as u64;
            if last_emit.elapsed() > Duration::from_millis(250) {
                let _ = app.emit(
                    "similarity_model_download_progress",
                    ProgressPayload {
                        current: (downloaded_before + received) as usize,
                        total: total as usize,
                        message: "Downloading the similarity model...".to_string(),
                    },
                );
                last_emit = Instant::now();
            }
        }
        output.flush().map_err(|e| e.to_string())?;
        if hex::encode(hasher.finalize()) != file.sha256 {
            return Err(format!("{} failed its integrity check", file.name));
        }
        Ok(())
    }
    .await;

    drop(output);
    let result = result.and_then(|()| match file.extract {
        Some(member) => extract_member(&partial, member, &dir.join(file.name)),
        None => std::fs::rename(&partial, dir.join(file.name)).map_err(|e| e.to_string()),
    });
    let _ = std::fs::remove_file(&partial);
    result
}

// ---------------------------------------------------------------------------
// Embedding storage and ranking

pub(crate) fn encode_embedding(vector: &[f32]) -> Vec<u8> {
    vector.iter().flat_map(|v| v.to_le_bytes()).collect()
}

pub(crate) fn decode_embedding(bytes: &[u8]) -> Option<Vec<f32>> {
    if bytes.len() != EMBEDDING_DIM * 4 {
        return None;
    }
    Some(
        bytes
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect(),
    )
}

/// Images that still need an embedding: never indexed, or changed size since then.
const PENDING_SQL: &str = "
    FROM images i
    LEFT JOIN image_clip_vectors e ON e.image_id = i.id AND e.model = ?1
    WHERE i.media_type = 'image'
      AND i.is_deleted = 0
      AND i.is_missing = 0
      AND i.path NOT LIKE 'blob:%'
      AND i.path NOT LIKE 'data:%'
      AND (e.image_id IS NULL OR IFNULL(e.source_size, -1) != IFNULL(i.file_size, -1))";

fn count_pending(conn: &Connection) -> Result<u32, String> {
    conn.query_row(&format!("SELECT COUNT(*) {PENDING_SQL}"), params![MODEL_ID], |row| row.get(0))
        .map_err(|e| e.to_string())
}

fn count_indexed(conn: &Connection) -> Result<u32, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM image_clip_vectors e JOIN images i ON i.id = e.image_id
         WHERE e.model = ?1 AND e.embedding IS NOT NULL AND i.is_deleted = 0",
        params![MODEL_ID],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn load_pending(conn: &Connection) -> Result<Vec<(String, String, Option<i64>)>, String> {
    let mut stmt = conn
        .prepare(&format!("SELECT i.id, i.path, i.file_size {PENDING_SQL} ORDER BY i.timestamp DESC"))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![MODEL_ID], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

pub(crate) fn save_embeddings(
    conn: &Connection,
    rows: &[(&str, Option<i64>, Option<Vec<f32>>)],
) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare_cached(
                "INSERT INTO image_clip_vectors (image_id, model, embedding, source_size, indexed_at)
                 VALUES (?1, ?2, ?3, ?4, strftime('%s', 'now'))
                 ON CONFLICT(image_id) DO UPDATE SET
                    model = excluded.model,
                    embedding = excluded.embedding,
                    source_size = excluded.source_size,
                    indexed_at = excluded.indexed_at",
            )
            .map_err(|e| e.to_string())?;
        for (id, size, embedding) in rows {
            let blob = embedding.as_deref().map(encode_embedding);
            stmt.execute(params![id, MODEL_ID, blob, size])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

fn stored_embedding(conn: &Connection, image_id: &str) -> Result<Option<Vec<f32>>, String> {
    let blob: Option<Vec<u8>> = conn
        .query_row(
            "SELECT embedding FROM image_clip_vectors WHERE image_id = ?1 AND model = ?2",
            params![image_id, MODEL_ID],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    Ok(blob.as_deref().and_then(decode_embedding))
}

/// Cosine similarity against every indexed library image (vectors are unit length,
/// so this is a dot product), keeping matches at or above `threshold`, best first.
pub(crate) fn rank_matches(
    conn: &Connection,
    query: &[f32],
    threshold: f32,
    limit: usize,
    exclude_id: Option<&str>,
) -> Result<Vec<SimilarityMatch>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT e.image_id, e.embedding FROM image_clip_vectors e
             JOIN images i ON i.id = e.image_id
             WHERE e.model = ?1 AND e.embedding IS NOT NULL
               AND i.is_deleted = 0 AND i.is_missing = 0",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![MODEL_ID]).map_err(|e| e.to_string())?;
    let mut matches = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let image_id: String = row.get(0).map_err(|e| e.to_string())?;
        if exclude_id == Some(image_id.as_str()) {
            continue;
        }
        let blob: Vec<u8> = row.get(1).map_err(|e| e.to_string())?;
        let Some(vector) = decode_embedding(&blob) else { continue };
        let similarity: f32 = vector.iter().zip(query).map(|(a, b)| a * b).sum();
        if similarity >= threshold {
            matches.push(SimilarityMatch { image_id, similarity });
        }
    }
    matches.sort_by(|a, b| b.similarity.total_cmp(&a.similarity));
    matches.truncate(limit);
    Ok(matches)
}

fn embed_file(engine: &ClipEngine, path: &str) -> Result<Vec<f32>, String> {
    engine
        .embed_images(&[path])?
        .into_iter()
        .next()
        .flatten()
        .ok_or_else(|| "That image could not be read".to_string())
}

fn index_inner(app: &AppHandle, conn: &Connection) -> Result<SimilarityIndexResult, String> {
    let state = app.state::<SimilarityState>();
    let engine = engine(app)?;
    let pending = load_pending(conn)?;
    let total = pending.len();
    let (mut indexed, mut failed, mut was_cancelled) = (0u32, 0u32, false);
    log::info!("[Similarity] Indexing {total} images");

    for (batch_index, batch) in pending.chunks(INDEX_BATCH_SIZE).enumerate() {
        if state.index_cancelled.load(Ordering::SeqCst) {
            was_cancelled = true;
            break;
        }
        let paths: Vec<&str> = batch.iter().map(|(_, path, _)| path.as_str()).collect();
        let embeddings = engine.embed_images(&paths)?;
        let rows: Vec<_> = batch
            .iter()
            .zip(embeddings)
            .map(|((id, _, size), embedding)| {
                if embedding.is_some() { indexed += 1 } else { failed += 1 }
                (id.as_str(), *size, embedding)
            })
            .collect();
        save_embeddings(conn, &rows)?;
        let _ = app.emit(
            "similarity_index_progress",
            ProgressPayload {
                current: (batch_index * INDEX_BATCH_SIZE) + batch.len(),
                total,
                message: "Indexing images for similarity search...".to_string(),
            },
        );
    }

    Ok(SimilarityIndexResult {
        indexed,
        failed,
        remaining: count_pending(conn)?,
        was_cancelled,
    })
}

fn search_inner(
    app: &AppHandle,
    conn: &Connection,
    query: SimilarityQuery,
    limit: usize,
    threshold: f32,
) -> Result<Vec<SimilarityMatch>, String> {
    let (vector, exclude_id) = match query {
        SimilarityQuery::Text { text } => {
            let text = text.trim();
            if text.is_empty() {
                return Err("Query text cannot be empty".to_string());
            }
            (engine(app)?.embed_text(text)?, None)
        }
        SimilarityQuery::LibraryImage { image_id } => {
            let vector = match stored_embedding(conn, &image_id)? {
                Some(vector) => vector,
                None => {
                    let path: String = conn
                        .query_row("SELECT path FROM images WHERE id = ?1", params![image_id], |row| row.get(0))
                        .optional()
                        .map_err(|e| e.to_string())?
                        .ok_or_else(|| "Image not found in library".to_string())?;
                    embed_file(&*engine(app)?, &path)?
                }
            };
            (vector, Some(image_id))
        }
        SimilarityQuery::File { path } => {
            let is_image = Path::new(&path)
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()));
            if !is_image {
                return Err("Choose a PNG, JPEG, WebP, BMP, GIF or TIFF image".to_string());
            }
            (embed_file(&*engine(app)?, &path)?, None)
        }
    };
    rank_matches(conn, &vector, threshold, limit, exclude_id.as_deref())
}

fn cluster_inner(conn: &Connection, options: ClusterOptions) -> Result<Vec<Vec<String>>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT e.image_id, e.embedding FROM image_clip_vectors e
             JOIN images i ON i.id = e.image_id
             WHERE e.model = ?1 AND e.embedding IS NOT NULL
               AND i.is_deleted = 0 AND i.is_missing = 0
             ORDER BY i.timestamp ASC, i.id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![MODEL_ID], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?)))
        .map_err(|e| e.to_string())?;
    let (mut ids, mut vectors) = (Vec::new(), Vec::new());
    for row in rows {
        let (id, blob) = row.map_err(|e| e.to_string())?;
        if let Some(vector) = decode_embedding(&blob) {
            ids.push(id);
            vectors.push(vector);
        }
    }
    if ids.len() < 2 {
        return Ok(Vec::new());
    }
    if ids.len() > MAX_CLUSTER_IMAGES {
        return Err(format!("Clustering supports up to {MAX_CLUSTER_IMAGES} indexed images"));
    }

    let cut = cluster::Cut::from_options(options.max_clusters.map(|v| v as usize), options.similarity_threshold);
    let labels = cluster::cluster(&vectors, cut);
    // SmartSim's page lists clusters by label number and each cluster's images in database order.
    let count = labels.iter().max().map_or(0, |max| max + 1);
    let mut clusters: Vec<Vec<String>> = vec![Vec::new(); count];
    for (id, label) in ids.into_iter().zip(labels) {
        clusters[label].push(id);
    }
    let min = options.min_images.unwrap_or(0) as usize;
    let max = options.max_images.map(|v| v as usize).unwrap_or(usize::MAX);
    clusters.retain(|members| members.len() >= min && members.len() <= max);
    Ok(clusters)
}

// ---------------------------------------------------------------------------
// Commands

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_similarity_status(app: AppHandle) -> Result<SimilarityStatus, String> {
    let worker = app.clone();
    run_blocking(app, move |conn| {
        let state = worker.state::<SimilarityState>();
        let dir = model_dir(&worker)?;
        finish_pending_runtime_removal(&dir);
        Ok(SimilarityStatus {
            model_installed: is_model_installed(&dir),
            model_downloading: state.downloading.load(Ordering::SeqCst),
            indexing: state.indexing.load(Ordering::SeqCst),
            model_size_bytes: remaining_download_size(&dir) as f64,
            indexed_count: count_indexed(conn)?,
            pending_count: count_pending(conn)?,
        })
    })
    .await
}

/// The only network path of this feature: a user-triggered download of the pinned model
/// files from Hugging Face and the ONNX Runtime release from GitHub.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn download_similarity_model(app: AppHandle) -> Result<(), String> {
    let state = app.state::<SimilarityState>();
    if state.downloading.swap(true, Ordering::SeqCst) {
        return Err("The model is already downloading".to_string());
    }
    state.download_cancelled.store(false, Ordering::SeqCst);

    let result = async {
        let dir = model_dir(&app)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(60))
            .build()
            .map_err(|e| e.to_string())?;
        let pending: Vec<&ModelFile> = MODEL_FILES.iter().filter(|file| !is_file_installed(&dir, file)).collect();
        let total: u64 = pending.iter().map(|file| file.download_size).sum();
        let mut done: u64 = 0;
        for file in pending {
            download_file(&app, &client, &dir, file, done, total).await?;
            done += file.download_size;
        }
        let _ = std::fs::remove_file(dir.join(RUNTIME_REMOVAL_MARKER));
        for legacy in LEGACY_FILES {
            let _ = std::fs::remove_file(dir.join(legacy));
        }
        let _ = app.emit(
            "similarity_model_download_progress",
            ProgressPayload {
                current: total as usize,
                total: total as usize,
                message: "Similarity model downloaded".to_string(),
            },
        );
        log::info!("[Similarity] Model downloaded");
        Ok(())
    }
    .await;

    state.downloading.store(false, Ordering::SeqCst);
    result
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn cancel_similarity_model_download(app: AppHandle) {
    app.state::<SimilarityState>()
        .download_cancelled
        .store(true, Ordering::SeqCst);
}

/// Removes the downloaded model files. Stored embeddings are kept, so re-downloading
/// the same model does not require re-indexing.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn delete_similarity_model(app: AppHandle) -> Result<(), String> {
    let state = app.state::<SimilarityState>();
    if state.downloading.load(Ordering::SeqCst) || state.indexing.load(Ordering::SeqCst) {
        return Err("Wait for the download or indexing to finish first".to_string());
    }
    // Dropping the engine closes the ONNX sessions, releasing the model files.
    *state.engine.lock().map_err(|e| e.to_string())? = None;
    let dir = model_dir(&app)?;
    for file in &MODEL_FILES {
        let path = dir.join(file.name);
        if !path.exists() {
            continue;
        }
        if file.name == RUNTIME_FILE && clip::is_runtime_loaded() {
            // A loaded DLL cannot be deleted on Windows; remove it on the next launch instead.
            std::fs::write(dir.join(RUNTIME_REMOVAL_MARKER), b"").map_err(|e| e.to_string())?;
            continue;
        }
        std::fs::remove_file(&path).map_err(|e| format!("Could not delete {}: {e}", file.name))?;
    }
    Ok(())
}

/// Completes a removal that had to leave `onnxruntime.dll` behind because it was loaded.
/// Runs before anything loads the runtime in this process.
fn finish_pending_runtime_removal(dir: &Path) {
    let marker = dir.join(RUNTIME_REMOVAL_MARKER);
    if !marker.exists() || clip::is_runtime_loaded() {
        return;
    }
    if std::fs::remove_file(dir.join(RUNTIME_FILE)).is_ok() || !dir.join(RUNTIME_FILE).exists() {
        let _ = std::fs::remove_file(&marker);
        let _ = std::fs::remove_dir(dir);
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn index_similarity_embeddings(app: AppHandle) -> Result<SimilarityIndexResult, String> {
    let state = app.state::<SimilarityState>();
    if state.indexing.swap(true, Ordering::SeqCst) {
        return Err("Indexing is already running".to_string());
    }
    state.index_cancelled.store(false, Ordering::SeqCst);
    let worker = app.clone();
    let result = run_blocking(app.clone(), move |conn| index_inner(&worker, conn)).await;
    state.indexing.store(false, Ordering::SeqCst);
    result
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn cancel_similarity_indexing(app: AppHandle) {
    app.state::<SimilarityState>()
        .index_cancelled
        .store(true, Ordering::SeqCst);
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn search_similar_images(
    app: AppHandle,
    query: SimilarityQuery,
    limit: u32,
    threshold: f32,
) -> Result<Vec<SimilarityMatch>, String> {
    if !(0.0..=1.0).contains(&threshold) {
        return Err("Similarity threshold must be between 0 and 1".to_string());
    }
    let worker = app.clone();
    run_blocking(app, move |conn| search_inner(&worker, conn, query, limit as usize, threshold)).await
}

/// SmartSim's `/search/cluster`: groups indexed library images, returning image ids per cluster
/// in scikit-learn's label order with each cluster's images oldest first, as SmartSim shows them.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn cluster_similar_images(app: AppHandle, options: ClusterOptions) -> Result<Vec<Vec<String>>, String> {
    if options.max_clusters.is_some_and(|v| v < 2) {
        return Err("Max number of clusters must be at least 2".to_string());
    }
    if options.similarity_threshold.is_some_and(|v| !(0.0..=1.0).contains(&v)) {
        return Err("Similarity threshold must be between 0 and 1".to_string());
    }
    if options.min_images.is_some_and(|v| v < 1) || options.max_images.is_some_and(|v| v < 1) {
        return Err("Cluster size must be at least 1".to_string());
    }
    run_blocking(app, move |conn| cluster_inner(conn, options)).await
}

#[cfg(test)]
mod tests {
    use super::{decode_embedding, encode_embedding, rank_matches, save_embeddings, EMBEDDING_DIM};
    use rusqlite::Connection;

    fn unit(axis: usize, tilt: f32) -> Vec<f32> {
        let mut v = vec![0.0; EMBEDDING_DIM];
        v[axis] = 1.0;
        v[(axis + 1) % EMBEDDING_DIM] = tilt;
        super::clip::l2_normalize(v)
    }

    fn library() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE images (id TEXT PRIMARY KEY, is_deleted INTEGER DEFAULT 0, is_missing INTEGER DEFAULT 0);
             CREATE TABLE image_clip_vectors (image_id TEXT PRIMARY KEY, model TEXT NOT NULL, embedding BLOB,
                source_size INTEGER, indexed_at INTEGER NOT NULL);
             INSERT INTO images (id) VALUES ('same'), ('close'), ('far'), ('failed'), ('query');
             INSERT INTO images (id, is_deleted) VALUES ('deleted', 1);",
        )
        .unwrap();
        save_embeddings(
            &conn,
            &[
                ("same", None, Some(unit(0, 0.0))),
                ("close", None, Some(unit(0, 0.5))),
                ("far", None, Some(unit(7, 0.0))),
                ("failed", None, None),
                ("query", None, Some(unit(0, 0.0))),
                ("deleted", None, Some(unit(0, 0.0))),
            ],
        )
        .unwrap();
        conn
    }

    #[test]
    fn embeddings_round_trip_as_little_endian_blobs() {
        let vector = unit(3, 0.25);
        assert_eq!(decode_embedding(&encode_embedding(&vector)), Some(vector));
        assert_eq!(decode_embedding(&[0u8; 12]), None);
    }

    #[test]
    fn ranks_by_cosine_similarity_above_threshold() {
        let conn = library();
        let matches = rank_matches(&conn, &unit(0, 0.0), 0.5, 10, Some("query")).unwrap();
        let ids: Vec<_> = matches.iter().map(|m| m.image_id.as_str()).collect();
        // Deleted, failed, excluded and below-threshold images are left out.
        assert_eq!(ids, ["same", "close"]);
        assert!((matches[0].similarity - 1.0).abs() < 1e-5);
        assert!((matches[1].similarity - 0.894_427).abs() < 1e-4);

        let top_one = rank_matches(&conn, &unit(0, 0.0), 0.0, 1, None).unwrap();
        assert_eq!(top_one.len(), 1);
    }
}
