use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 85: Cache table for the Presets page. Each row holds an image's
/// model + LoRA + sampler signature, rebuilt in full by
/// `rebuild_generation_presets`, so no existing rows need backfilling here.
pub fn migration85() -> Migration {
    Migration {
        version: 85,
        description: "add_generation_presets_cache",
        sql: r#"
            CREATE TABLE IF NOT EXISTS image_presets (
                image_id TEXT PRIMARY KEY NOT NULL,
                strict_key TEXT NOT NULL,
                loose_key TEXT NOT NULL,
                preset_model TEXT NOT NULL,
                preset_sampler TEXT NOT NULL,
                preset_loras_strict TEXT NOT NULL,
                preset_loras_loose TEXT NOT NULL,
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_image_presets_strict_key
                ON image_presets(strict_key, image_id);
            CREATE INDEX IF NOT EXISTS idx_image_presets_loose_key
                ON image_presets(loose_key, image_id);
        "#,
        kind: MigrationKind::Up,
    }
}
