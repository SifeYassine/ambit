use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 89: Retries images that the similarity indexer recorded as unreadable. Before this
/// version it picked the decoder from the file extension, so JPEG or WebP data saved as `.png`
/// failed; removing those rows puts them back in the indexing queue.
pub fn migration89() -> Migration {
    Migration {
        version: 89,
        description: "retry_unreadable_clip_vectors",
        sql: "DELETE FROM image_clip_vectors WHERE embedding IS NULL;",
        kind: MigrationKind::Up,
    }
}
