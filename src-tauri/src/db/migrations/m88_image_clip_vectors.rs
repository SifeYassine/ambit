use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 88: CLIP image embeddings for the Similarity page. Rows are written by
/// `index_similarity_embeddings` after the user downloads the model, so nothing is
/// backfilled here. `embedding` is NULL when the image could not be decoded, which
/// stops it from being retried until its file size changes.
pub fn migration88() -> Migration {
    Migration {
        version: 88,
        description: "add_image_clip_vectors",
        sql: r#"
            CREATE TABLE IF NOT EXISTS image_clip_vectors (
                image_id TEXT PRIMARY KEY NOT NULL,
                model TEXT NOT NULL,
                embedding BLOB,
                source_size INTEGER,
                indexed_at INTEGER NOT NULL,
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE ON UPDATE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_image_clip_vectors_model
                ON image_clip_vectors(model, image_id);
        "#,
        kind: MigrationKind::Up,
    }
}
