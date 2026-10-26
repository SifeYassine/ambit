use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 87: Tracks whether the Presets cache (`image_presets`) is out of date, so opening
/// the page reuses it like the gallery reuses its tables, instead of rebuilding it every launch.
/// Triggers mark it dirty when an image is added or removed, or when a column the preset
/// signature reads actually changes; `rebuild_generation_presets` clears it in the rebuild
/// transaction. It starts dirty, so the first open after upgrading builds the cache once.
pub fn migration87() -> Migration {
    Migration {
        version: 87,
        description: "add_preset_cache_state",
        sql: r#"
            CREATE TABLE IF NOT EXISTS preset_cache_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                dirty INTEGER NOT NULL DEFAULT 1
            );
            INSERT OR IGNORE INTO preset_cache_state (id, dirty) VALUES (1, 1);

            CREATE TRIGGER IF NOT EXISTS preset_cache_insert_dirty AFTER INSERT ON images
            BEGIN
                UPDATE preset_cache_state SET dirty = 1 WHERE id = 1 AND dirty = 0;
            END;

            CREATE TRIGGER IF NOT EXISTS preset_cache_delete_dirty AFTER DELETE ON images
            BEGIN
                UPDATE preset_cache_state SET dirty = 1 WHERE id = 1 AND dirty = 0;
            END;

            CREATE TRIGGER IF NOT EXISTS preset_cache_update_dirty
            AFTER UPDATE OF resolved_model_name, sampler, metadata_json, is_deleted ON images
            WHEN OLD.resolved_model_name IS NOT NEW.resolved_model_name
                OR OLD.sampler IS NOT NEW.sampler
                OR OLD.metadata_json IS NOT NEW.metadata_json
                OR OLD.is_deleted IS NOT NEW.is_deleted
            BEGIN
                UPDATE preset_cache_state SET dirty = 1 WHERE id = 1 AND dirty = 0;
            END;
        "#,
        kind: MigrationKind::Up,
    }
}
