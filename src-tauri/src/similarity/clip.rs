//! CLIP ViT-B/16 inference on the CPU with ONNX Runtime, matching SmartSim's
//! `EmbeddingService` (Hugging Face `CLIPModel` + `CLIPProcessor`): shortest side resized
//! to 224 with bicubic filtering, 224 center crop, CLIP mean/std normalization, and
//! L2-normalized image/text projections.
//!
//! The ONNX graphs are Xenova's exports of `openai/clip-vit-base-patch16`
//! (`vision_model.onnx` → `image_embeds`, `text_model.onnx` → `text_embeds`).
//! `onnxruntime.dll` is loaded at runtime from app data (the `load-dynamic` feature),
//! so nothing is linked against MSVC import libraries.

use image::{imageops::FilterType, DynamicImage};
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use rayon::prelude::*;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use tokenizers::Tokenizer;

pub const EMBEDDING_DIM: usize = 512;
const IMAGE_SIZE: u32 = 224;
const MAX_TEXT_TOKENS: usize = 77;
const END_OF_TEXT_TOKEN: u32 = 49407;
const IMAGE_MEAN: [f32; 3] = [0.481_454_66, 0.457_827_5, 0.408_210_73];
const IMAGE_STD: [f32; 3] = [0.268_629_54, 0.261_302_58, 0.275_777_11];

/// ONNX Runtime can be initialized once per process; the result is kept so a failed
/// load reports the same error instead of retrying a half-initialized library.
static RUNTIME: OnceLock<Result<(), String>> = OnceLock::new();

/// Whether `onnxruntime.dll` has been loaded into this process; Windows cannot delete it then.
pub fn is_runtime_loaded() -> bool {
    RUNTIME.get().is_some()
}

fn init_runtime(library: &Path) -> Result<(), String> {
    RUNTIME
        .get_or_init(|| {
            let builder = ort::init_from(library)
                .map_err(|e| format!("Failed to load ONNX Runtime: {e}"))?;
            builder.with_name("ambit-similarity").commit();
            Ok(())
        })
        .clone()
}

/// The intra-op thread count is left at ONNX Runtime's default, one per physical core:
/// hyper-threads share the same vector units, so using every logical core slows CLIP down.
fn open_session(model: &Path) -> Result<Session, String> {
    Session::builder()
        .map_err(|e| e.to_string())?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| e.to_string())?
        .commit_from_file(model)
        .map_err(|e| format!("Failed to load {}: {e}", model.display()))
}

fn output_name(session: &Session, preferred: &str) -> String {
    session
        .outputs()
        .iter()
        .find(|output| output.name() == preferred)
        .or_else(|| session.outputs().first())
        .map(|output| output.name().to_string())
        .unwrap_or_else(|| preferred.to_string())
}

pub struct ClipEngine {
    vision: Mutex<Session>,
    text: Mutex<Session>,
    vision_input: String,
    vision_output: String,
    text_output: String,
    text_takes_mask: bool,
    tokenizer: Tokenizer,
}

impl ClipEngine {
    pub fn load(runtime: &Path, vision: &Path, text: &Path, tokenizer: &Path) -> Result<Self, String> {
        init_runtime(runtime)?;
        let vision = open_session(vision)?;
        let text = open_session(text)?;
        let vision_input = vision
            .inputs()
            .first()
            .map(|input| input.name().to_string())
            .unwrap_or_else(|| "pixel_values".to_string());
        let vision_output = output_name(&vision, "image_embeds");
        let text_output = output_name(&text, "text_embeds");
        let text_takes_mask = text.inputs().iter().any(|input| input.name() == "attention_mask");
        let tokenizer = Tokenizer::from_file(tokenizer)
            .map_err(|e| format!("Failed to load the similarity tokenizer: {e}"))?;
        Ok(Self {
            vision: Mutex::new(vision),
            text: Mutex::new(text),
            vision_input,
            vision_output,
            text_output,
            text_takes_mask,
            tokenizer,
        })
    }

    /// Embeds a batch of images. Each slot is `None` when that image failed to decode,
    /// so callers can record failures without dropping the rest of the batch.
    pub fn embed_images(&self, paths: &[&str]) -> Result<Vec<Option<Vec<f32>>>, String> {
        let pixels: Vec<Option<Vec<f32>>> = paths
            .par_iter()
            .map(|path| match open_image(path) {
                Ok(image) => Some(preprocess(&image)),
                Err(error) => {
                    log::warn!("[Similarity] Could not decode {path}: {error}");
                    None
                }
            })
            .collect();

        let decoded: Vec<&Vec<f32>> = pixels.iter().flatten().collect();
        let mut features = if decoded.is_empty() {
            Vec::new()
        } else {
            let side = IMAGE_SIZE as usize;
            let flat: Vec<f32> = decoded.iter().flat_map(|p| p.iter().copied()).collect();
            let input = Tensor::from_array(([decoded.len(), 3, side, side], flat)).map_err(|e| e.to_string())?;
            let mut session = self.vision.lock().map_err(|e| e.to_string())?;
            let outputs = session
                .run(ort::inputs![self.vision_input.as_str() => input])
                .map_err(|e| e.to_string())?;
            let (_, values) = outputs[self.vision_output.as_str()]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?;
            to_normalized_rows(values)?
        }
        .into_iter();

        Ok(pixels
            .iter()
            .map(|slot| slot.as_ref().and_then(|_| features.next()))
            .collect())
    }

    pub fn embed_text(&self, text: &str) -> Result<Vec<f32>, String> {
        let encoding = self
            .tokenizer
            .encode(text, true)
            .map_err(|e| format!("Failed to tokenize the query: {e}"))?;
        let mut ids: Vec<i64> = encoding.get_ids().iter().map(|&id| id as i64).collect();
        if ids.len() > MAX_TEXT_TOKENS {
            ids.truncate(MAX_TEXT_TOKENS - 1);
            ids.push(END_OF_TEXT_TOKEN as i64);
        }
        let length = ids.len();
        let input_ids = Tensor::from_array(([1, length], ids)).map_err(|e| e.to_string())?;
        let mut session = self.text.lock().map_err(|e| e.to_string())?;
        let outputs = if self.text_takes_mask {
            let mask = Tensor::from_array(([1, length], vec![1i64; length])).map_err(|e| e.to_string())?;
            session.run(ort::inputs!["input_ids" => input_ids, "attention_mask" => mask])
        } else {
            session.run(ort::inputs!["input_ids" => input_ids])
        }
        .map_err(|e| e.to_string())?;
        let (_, values) = outputs[self.text_output.as_str()]
            .try_extract_tensor::<f32>()
            .map_err(|e| e.to_string())?;
        to_normalized_rows(values)?
            .into_iter()
            .next()
            .ok_or_else(|| "The model returned no text features".to_string())
    }
}

fn to_normalized_rows(values: &[f32]) -> Result<Vec<Vec<f32>>, String> {
    if values.len() % EMBEDDING_DIM != 0 {
        return Err(format!("Unexpected embedding size {}", values.len()));
    }
    Ok(values
        .chunks_exact(EMBEDDING_DIM)
        .map(|row| l2_normalize(row.to_vec()))
        .collect())
}

pub fn l2_normalize(mut vector: Vec<f32>) -> Vec<f32> {
    let norm = vector.iter().map(|v| v * v).sum::<f32>().sqrt().max(1e-12);
    vector.iter_mut().for_each(|v| *v /= norm);
    vector
}

/// Decodes by content rather than extension, like the thumbnail generator: generation sites often
/// serve JPEG or WebP data under a `.png` name. No EXIF rotation, matching SmartSim's CLIP input.
fn open_image(path: &str) -> Result<DynamicImage, String> {
    image::ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())
}

/// CHW float pixels in CLIP's input space.
fn preprocess(image: &DynamicImage) -> Vec<f32> {
    let rgb = image.to_rgb8();
    let (width, height) = rgb.dimensions();
    let short = width.min(height).max(1);
    let scale = IMAGE_SIZE as f64 / short as f64;
    let resized_w = ((width as f64 * scale) as u32).max(IMAGE_SIZE);
    let resized_h = ((height as f64 * scale) as u32).max(IMAGE_SIZE);
    let resized = image::imageops::resize(&rgb, resized_w, resized_h, FilterType::CatmullRom);
    let left = (resized_w - IMAGE_SIZE) / 2;
    let top = (resized_h - IMAGE_SIZE) / 2;

    let side = IMAGE_SIZE as usize;
    let mut pixels = vec![0f32; 3 * side * side];
    for y in 0..IMAGE_SIZE {
        for x in 0..IMAGE_SIZE {
            let pixel = resized.get_pixel(left + x, top + y);
            let offset = y as usize * side + x as usize;
            for channel in 0..3 {
                let value = pixel[channel] as f32 / 255.0;
                pixels[channel * side * side + offset] =
                    (value - IMAGE_MEAN[channel]) / IMAGE_STD[channel];
            }
        }
    }
    pixels
}

#[cfg(test)]
mod tests {
    use super::open_image;
    use image::{DynamicImage, ImageFormat};

    #[test]
    fn decodes_images_saved_under_the_wrong_extension() {
        let dir = std::env::temp_dir().join(format!("ambit-clip-open-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for (name, format) in [("jpeg.png", ImageFormat::Jpeg), ("webp.png", ImageFormat::WebP)] {
            let path = dir.join(name);
            DynamicImage::new_rgb8(16, 12).save_with_format(&path, format).unwrap();
            let path = path.to_string_lossy();
            assert!(image::open(path.as_ref()).is_err(), "{name} should not decode by extension");
            let decoded = open_image(&path).unwrap();
            assert_eq!((decoded.width(), decoded.height()), (16, 12), "{name}");
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
