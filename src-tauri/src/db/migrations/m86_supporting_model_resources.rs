use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 86: Junction tables for supporting models (VAEs, upscale models, CLIP Vision
/// encoders, detection models), with the same indexes and owner-scope invalidation triggers as
/// the existing resource junctions. The image update triggers from migration 78 are recreated
/// unchanged except that their resource union also covers the new tables.
pub fn migration86() -> Migration {
    Migration {
        version: 86,
        description: "add_supporting_model_resources",
        sql: r#"
            CREATE TABLE IF NOT EXISTS image_vaes (
                image_id TEXT NOT NULL,
                vae_name TEXT NOT NULL,
                PRIMARY KEY (image_id, vae_name),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            ) STRICT;
            CREATE INDEX IF NOT EXISTS idx_vaes_by_name_image_v1 ON image_vaes(vae_name, image_id);
            CREATE INDEX IF NOT EXISTS idx_vaes_canonical_name_image_v1
                ON image_vaes (
                    (CASE
                        WHEN instr(vae_name, ' (') > 0 THEN trim(substr(vae_name, 1, instr(vae_name, ' (') - 1))
                        WHEN instr(vae_name, ':') > 0 THEN trim(substr(vae_name, 1, instr(vae_name, ':') - 1))
                        ELSE trim(vae_name)
                    END) COLLATE NOCASE,
                    image_id
                );
            CREATE TRIGGER invoke_scope_cache_vaes_insert_dirty AFTER INSERT ON image_vaes BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id = NEW.image_id);
            END;
            CREATE TRIGGER invoke_scope_cache_vaes_update_dirty AFTER UPDATE ON image_vaes BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id IN (OLD.image_id, NEW.image_id));
            END;
            CREATE TRIGGER invoke_scope_cache_vaes_delete_dirty AFTER DELETE ON image_vaes BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id = OLD.image_id);
            END;
            CREATE TRIGGER invoke_scope_cache_vaes_insert_detail AFTER INSERT ON image_vaes BEGIN
                INSERT INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'vaes', NEW.vae_name
                FROM invoke_scope_cache_visible_image_scopes
                WHERE image_id = NEW.image_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;
            CREATE TRIGGER invoke_scope_cache_vaes_update_detail AFTER UPDATE ON image_vaes BEGIN
                INSERT INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'vaes', resource_name
                FROM invoke_scope_cache_visible_image_scopes
                CROSS JOIN (SELECT OLD.vae_name AS resource_name UNION SELECT NEW.vae_name)
                WHERE image_id IN (OLD.image_id, NEW.image_id)
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;
            CREATE TRIGGER invoke_scope_cache_vaes_delete_detail AFTER DELETE ON image_vaes BEGIN
                INSERT INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'vaes', OLD.vae_name
                FROM invoke_scope_cache_visible_image_scopes
                WHERE image_id = OLD.image_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;

            CREATE TABLE IF NOT EXISTS image_upscalers (
                image_id TEXT NOT NULL,
                upscaler_name TEXT NOT NULL,
                PRIMARY KEY (image_id, upscaler_name),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            ) STRICT;
            CREATE INDEX IF NOT EXISTS idx_upscalers_by_name_image_v1 ON image_upscalers(upscaler_name, image_id);
            CREATE INDEX IF NOT EXISTS idx_upscalers_canonical_name_image_v1
                ON image_upscalers (
                    (CASE
                        WHEN instr(upscaler_name, ' (') > 0 THEN trim(substr(upscaler_name, 1, instr(upscaler_name, ' (') - 1))
                        WHEN instr(upscaler_name, ':') > 0 THEN trim(substr(upscaler_name, 1, instr(upscaler_name, ':') - 1))
                        ELSE trim(upscaler_name)
                    END) COLLATE NOCASE,
                    image_id
                );
            CREATE TRIGGER invoke_scope_cache_upscalers_insert_dirty AFTER INSERT ON image_upscalers BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id = NEW.image_id);
            END;
            CREATE TRIGGER invoke_scope_cache_upscalers_update_dirty AFTER UPDATE ON image_upscalers BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id IN (OLD.image_id, NEW.image_id));
            END;
            CREATE TRIGGER invoke_scope_cache_upscalers_delete_dirty AFTER DELETE ON image_upscalers BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id = OLD.image_id);
            END;
            CREATE TRIGGER invoke_scope_cache_upscalers_insert_detail AFTER INSERT ON image_upscalers BEGIN
                INSERT INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'upscalers', NEW.upscaler_name
                FROM invoke_scope_cache_visible_image_scopes
                WHERE image_id = NEW.image_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;
            CREATE TRIGGER invoke_scope_cache_upscalers_update_detail AFTER UPDATE ON image_upscalers BEGIN
                INSERT INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'upscalers', resource_name
                FROM invoke_scope_cache_visible_image_scopes
                CROSS JOIN (SELECT OLD.upscaler_name AS resource_name UNION SELECT NEW.upscaler_name)
                WHERE image_id IN (OLD.image_id, NEW.image_id)
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;
            CREATE TRIGGER invoke_scope_cache_upscalers_delete_detail AFTER DELETE ON image_upscalers BEGIN
                INSERT INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'upscalers', OLD.upscaler_name
                FROM invoke_scope_cache_visible_image_scopes
                WHERE image_id = OLD.image_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;

            CREATE TABLE IF NOT EXISTS image_clip_visions (
                image_id TEXT NOT NULL,
                clip_vision_name TEXT NOT NULL,
                PRIMARY KEY (image_id, clip_vision_name),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            ) STRICT;
            CREATE INDEX IF NOT EXISTS idx_clip_visions_by_name_image_v1 ON image_clip_visions(clip_vision_name, image_id);
            CREATE INDEX IF NOT EXISTS idx_clip_visions_canonical_name_image_v1
                ON image_clip_visions (
                    (CASE
                        WHEN instr(clip_vision_name, ' (') > 0 THEN trim(substr(clip_vision_name, 1, instr(clip_vision_name, ' (') - 1))
                        WHEN instr(clip_vision_name, ':') > 0 THEN trim(substr(clip_vision_name, 1, instr(clip_vision_name, ':') - 1))
                        ELSE trim(clip_vision_name)
                    END) COLLATE NOCASE,
                    image_id
                );
            CREATE TRIGGER invoke_scope_cache_clip_visions_insert_dirty AFTER INSERT ON image_clip_visions BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id = NEW.image_id);
            END;
            CREATE TRIGGER invoke_scope_cache_clip_visions_update_dirty AFTER UPDATE ON image_clip_visions BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id IN (OLD.image_id, NEW.image_id));
            END;
            CREATE TRIGGER invoke_scope_cache_clip_visions_delete_dirty AFTER DELETE ON image_clip_visions BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id = OLD.image_id);
            END;
            CREATE TRIGGER invoke_scope_cache_clip_visions_insert_detail AFTER INSERT ON image_clip_visions BEGIN
                INSERT INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'clip_visions', NEW.clip_vision_name
                FROM invoke_scope_cache_visible_image_scopes
                WHERE image_id = NEW.image_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;
            CREATE TRIGGER invoke_scope_cache_clip_visions_update_detail AFTER UPDATE ON image_clip_visions BEGIN
                INSERT INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'clip_visions', resource_name
                FROM invoke_scope_cache_visible_image_scopes
                CROSS JOIN (SELECT OLD.clip_vision_name AS resource_name UNION SELECT NEW.clip_vision_name)
                WHERE image_id IN (OLD.image_id, NEW.image_id)
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;
            CREATE TRIGGER invoke_scope_cache_clip_visions_delete_detail AFTER DELETE ON image_clip_visions BEGIN
                INSERT INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'clip_visions', OLD.clip_vision_name
                FROM invoke_scope_cache_visible_image_scopes
                WHERE image_id = OLD.image_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;

            CREATE TABLE IF NOT EXISTS image_detectors (
                image_id TEXT NOT NULL,
                detector_name TEXT NOT NULL,
                PRIMARY KEY (image_id, detector_name),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            ) STRICT;
            CREATE INDEX IF NOT EXISTS idx_detectors_by_name_image_v1 ON image_detectors(detector_name, image_id);
            CREATE INDEX IF NOT EXISTS idx_detectors_canonical_name_image_v1
                ON image_detectors (
                    (CASE
                        WHEN instr(detector_name, ' (') > 0 THEN trim(substr(detector_name, 1, instr(detector_name, ' (') - 1))
                        WHEN instr(detector_name, ':') > 0 THEN trim(substr(detector_name, 1, instr(detector_name, ':') - 1))
                        ELSE trim(detector_name)
                    END) COLLATE NOCASE,
                    image_id
                );
            CREATE TRIGGER invoke_scope_cache_detectors_insert_dirty AFTER INSERT ON image_detectors BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id = NEW.image_id);
            END;
            CREATE TRIGGER invoke_scope_cache_detectors_update_dirty AFTER UPDATE ON image_detectors BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id IN (OLD.image_id, NEW.image_id));
            END;
            CREATE TRIGGER invoke_scope_cache_detectors_delete_dirty AFTER DELETE ON image_detectors BEGIN
                UPDATE invoke_scope_cache_state SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND scope_key IN (SELECT scope_key FROM invoke_scope_cache_visible_image_scopes WHERE image_id = OLD.image_id);
            END;
            CREATE TRIGGER invoke_scope_cache_detectors_insert_detail AFTER INSERT ON image_detectors BEGIN
                INSERT INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'detectors', NEW.detector_name
                FROM invoke_scope_cache_visible_image_scopes
                WHERE image_id = NEW.image_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;
            CREATE TRIGGER invoke_scope_cache_detectors_update_detail AFTER UPDATE ON image_detectors BEGIN
                INSERT INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'detectors', resource_name
                FROM invoke_scope_cache_visible_image_scopes
                CROSS JOIN (SELECT OLD.detector_name AS resource_name UNION SELECT NEW.detector_name)
                WHERE image_id IN (OLD.image_id, NEW.image_id)
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;
            CREATE TRIGGER invoke_scope_cache_detectors_delete_detail AFTER DELETE ON image_detectors BEGIN
                INSERT INTO invoke_scope_cache_dirty_items
                SELECT scope_key, 'facet_resource', 'detectors', OLD.detector_name
                FROM invoke_scope_cache_visible_image_scopes
                WHERE image_id = OLD.image_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;

            DROP TRIGGER IF EXISTS invoke_scope_cache_images_update_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_images_update_detail;

            CREATE TRIGGER invoke_scope_cache_images_update_dirty
            AFTER UPDATE OF
                id, path, width, height, file_size, timestamp, metadata_json,
                thumbnail_path, is_favorite, is_pinned, is_deleted, is_missing,
                user_masked, group_id, notes, original_metadata_json, board_id,
                model_hash, model_name, tool, resolved_model_name, steps, cfg,
                sampler, generation_type, original_state_json, thumbnail_source,
                micro_thumbnail, positive_prompt, negative_prompt, is_corrupt,
                parser_version, original_parsed_json, privacy_hidden, file_hash,
                thumbnail_version, seed, invoke_image_name, invoke_image_category,
                invoke_image_origin, invoke_owner_id, invoke_source_id
            ON images
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (
                      scope_key IN (
                          SELECT scope_key FROM invoke_scope_cache_visible_image_scopes
                          WHERE image_id = NEW.id
                      )
                      OR (OLD.invoke_source_id IS NULL AND OLD.invoke_scope_hidden = 0)
                      OR (
                          db_path = OLD.invoke_source_id
                          AND (
                              scope_mode IN ('legacy', 'all')
                              OR (scope_mode = 'owner' AND owner_id = OLD.invoke_owner_id)
                          )
                      )
                  );
            END;

            CREATE TRIGGER invoke_scope_cache_images_update_detail
            AFTER UPDATE OF
                id, path, width, height, file_size, timestamp, metadata_json,
                thumbnail_path, is_favorite, is_pinned, is_deleted, is_missing,
                user_masked, group_id, notes, original_metadata_json, board_id,
                model_hash, model_name, tool, resolved_model_name, steps, cfg,
                sampler, generation_type, original_state_json, thumbnail_source,
                micro_thumbnail, positive_prompt, negative_prompt, is_corrupt,
                parser_version, original_parsed_json, privacy_hidden, file_hash,
                thumbnail_version, seed, invoke_image_name, invoke_image_category,
                invoke_image_origin, invoke_owner_id, invoke_source_id
            ON images
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                INSERT INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT scope_key, 'full', '', ''
                FROM invoke_scope_cache_state
                WHERE (OLD.id IS NOT NEW.id
                       OR OLD.invoke_owner_id IS NOT NEW.invoke_owner_id
                       OR OLD.invoke_source_id IS NOT NEW.invoke_source_id)
                  AND (
                       (OLD.invoke_source_id IS NULL AND OLD.invoke_scope_hidden = 0)
                       OR (db_path = OLD.invoke_source_id AND (
                            scope_mode IN ('legacy', 'all')
                            OR (scope_mode = 'owner' AND owner_id = OLD.invoke_owner_id)
                       ))
                       OR (NEW.invoke_source_id IS NULL AND NEW.invoke_scope_hidden = 0)
                       OR (db_path = NEW.invoke_source_id AND (
                            scope_mode IN ('legacy', 'all')
                            OR (scope_mode = 'owner' AND owner_id = NEW.invoke_owner_id)
                       ))
                  )
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;

                INSERT INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT scope_key, 'facet_resource', 'checkpoints', resource_name
                FROM invoke_scope_cache_state
                CROSS JOIN (
                    SELECT COALESCE(NULLIF(TRIM(OLD.resolved_model_name), ''),
                                    NULLIF(TRIM(OLD.model_name), ''), 'Unknown') AS resource_name
                    UNION
                    SELECT COALESCE(NULLIF(TRIM(NEW.resolved_model_name), ''),
                                    NULLIF(TRIM(NEW.model_name), ''), 'Unknown')
                ) resources
                WHERE (OLD.invoke_source_id IS NULL AND OLD.invoke_scope_hidden = 0)
                   OR (db_path = OLD.invoke_source_id AND (
                        scope_mode IN ('legacy', 'all')
                        OR (scope_mode = 'owner' AND owner_id = OLD.invoke_owner_id)
                   ))
                   OR (NEW.invoke_source_id IS NULL AND NEW.invoke_scope_hidden = 0)
                   OR (db_path = NEW.invoke_source_id AND (
                        scope_mode IN ('legacy', 'all')
                        OR (scope_mode = 'owner' AND owner_id = NEW.invoke_owner_id)
                   ))
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;

                INSERT INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT scope_key, 'facet_resource', 'tools', resource_name
                FROM invoke_scope_cache_state
                CROSS JOIN (
                    SELECT COALESCE(NULLIF(TRIM(OLD.tool), ''), 'Unknown') AS resource_name
                    UNION
                    SELECT COALESCE(NULLIF(TRIM(NEW.tool), ''), 'Unknown')
                ) resources
                WHERE (OLD.invoke_source_id IS NULL AND OLD.invoke_scope_hidden = 0)
                   OR (db_path = OLD.invoke_source_id AND (
                        scope_mode IN ('legacy', 'all')
                        OR (scope_mode = 'owner' AND owner_id = OLD.invoke_owner_id)
                   ))
                   OR (NEW.invoke_source_id IS NULL AND NEW.invoke_scope_hidden = 0)
                   OR (db_path = NEW.invoke_source_id AND (
                        scope_mode IN ('legacy', 'all')
                        OR (scope_mode = 'owner' AND owner_id = NEW.invoke_owner_id)
                   ))
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;

                INSERT INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT cache.scope_key, 'facet_resource', resources.facet_type, resources.resource_name
                FROM invoke_scope_cache_state cache
                CROSS JOIN (
                    SELECT 'loras' AS facet_type, lora_name AS resource_name
                    FROM image_loras WHERE image_id IN (OLD.id, NEW.id)
                    UNION SELECT 'embeddings', embedding_name
                    FROM image_embeddings WHERE image_id IN (OLD.id, NEW.id)
                    UNION SELECT 'hypernetworks', hypernetwork_name
                    FROM image_hypernetworks WHERE image_id IN (OLD.id, NEW.id)
                    UNION SELECT 'control_nets', controlnet_name
                    FROM image_controlnets WHERE image_id IN (OLD.id, NEW.id)
                    UNION SELECT 'ip_adapters', ipadapter_name
                    FROM image_ipadapters WHERE image_id IN (OLD.id, NEW.id)
                    UNION SELECT 'vaes', vae_name
                    FROM image_vaes WHERE image_id IN (OLD.id, NEW.id)
                    UNION SELECT 'upscalers', upscaler_name
                    FROM image_upscalers WHERE image_id IN (OLD.id, NEW.id)
                    UNION SELECT 'clip_visions', clip_vision_name
                    FROM image_clip_visions WHERE image_id IN (OLD.id, NEW.id)
                    UNION SELECT 'detectors', detector_name
                    FROM image_detectors WHERE image_id IN (OLD.id, NEW.id)
                ) resources
                WHERE (OLD.invoke_source_id IS NULL AND OLD.invoke_scope_hidden = 0)
                   OR (cache.db_path = OLD.invoke_source_id AND (
                        cache.scope_mode IN ('legacy', 'all')
                        OR (cache.scope_mode = 'owner' AND cache.owner_id = OLD.invoke_owner_id)
                   ))
                   OR (NEW.invoke_source_id IS NULL AND NEW.invoke_scope_hidden = 0)
                   OR (cache.db_path = NEW.invoke_source_id AND (
                        cache.scope_mode IN ('legacy', 'all')
                        OR (cache.scope_mode = 'owner' AND cache.owner_id = NEW.invoke_owner_id)
                   ))
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;

                INSERT INTO invoke_scope_cache_dirty_items
                    (scope_key, domain, facet_type, resource_name)
                SELECT scope_key, 'collections', '', ''
                FROM invoke_scope_cache_state
                WHERE (OLD.invoke_source_id IS NULL AND OLD.invoke_scope_hidden = 0)
                   OR (db_path = OLD.invoke_source_id AND (
                        scope_mode IN ('legacy', 'all')
                        OR (scope_mode = 'owner' AND owner_id = OLD.invoke_owner_id)
                   ))
                   OR (NEW.invoke_source_id IS NULL AND NEW.invoke_scope_hidden = 0)
                   OR (db_path = NEW.invoke_source_id AND (
                        scope_mode IN ('legacy', 'all')
                        OR (scope_mode = 'owner' AND owner_id = NEW.invoke_owner_id)
                   ))
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;

            -- Model inventory changes for the new types refresh their own facets instead of a full rebuild.
            DROP TRIGGER IF EXISTS invoke_scope_cache_models_insert_detail;
            DROP TRIGGER IF EXISTS invoke_scope_cache_models_update_detail;
            DROP TRIGGER IF EXISTS invoke_scope_cache_models_delete_detail;
            CREATE TRIGGER invoke_scope_cache_models_insert_detail AFTER INSERT ON models BEGIN
                INSERT INTO invoke_scope_cache_dirty_items
                SELECT scope_key,
                       CASE WHEN NEW.resource_type IN ('checkpoint', 'checkpoints', 'loras', 'embeddings', 'hypernetworks', 'control_nets', 'ip_adapters', 'vaes', 'upscalers', 'clip_visions', 'detectors')
                            THEN 'facet_resource' ELSE 'full' END,
                       CASE NEW.resource_type WHEN 'checkpoint' THEN 'checkpoints' ELSE COALESCE(NEW.resource_type, '') END,
                       CASE WHEN NEW.resource_type IN ('checkpoint', 'checkpoints', 'loras', 'embeddings', 'hypernetworks', 'control_nets', 'ip_adapters', 'vaes', 'upscalers', 'clip_visions', 'detectors')
                            THEN COALESCE(NEW.name, '') ELSE '' END
                FROM invoke_scope_cache_state
                WHERE (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND NOT (
                      status = 'building'
                      AND scope_key = (SELECT active_scope_key FROM invoke_scope_cache_control WHERE state_key = 'current')
                      AND (SELECT suppress_active_model_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 1
                  )
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;
            CREATE TRIGGER invoke_scope_cache_models_update_detail AFTER UPDATE ON models BEGIN
                INSERT INTO invoke_scope_cache_dirty_items
                SELECT cache.scope_key,
                       CASE WHEN resource_type IN ('checkpoint', 'checkpoints', 'loras', 'embeddings', 'hypernetworks', 'control_nets', 'ip_adapters', 'vaes', 'upscalers', 'clip_visions', 'detectors')
                            THEN 'facet_resource' ELSE 'full' END,
                       CASE resource_type WHEN 'checkpoint' THEN 'checkpoints' ELSE COALESCE(resource_type, '') END,
                       CASE WHEN resource_type IN ('checkpoint', 'checkpoints', 'loras', 'embeddings', 'hypernetworks', 'control_nets', 'ip_adapters', 'vaes', 'upscalers', 'clip_visions', 'detectors')
                            THEN COALESCE(resource_name, '') ELSE '' END
                FROM invoke_scope_cache_state cache
                CROSS JOIN (
                    SELECT OLD.resource_type AS resource_type, OLD.name AS resource_name
                    UNION SELECT NEW.resource_type, NEW.name
                ) resources
                WHERE (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND NOT (
                      cache.status = 'building'
                      AND cache.scope_key = (SELECT active_scope_key FROM invoke_scope_cache_control WHERE state_key = 'current')
                      AND (SELECT suppress_active_model_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 1
                  )
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;
            CREATE TRIGGER invoke_scope_cache_models_delete_detail AFTER DELETE ON models BEGIN
                INSERT INTO invoke_scope_cache_dirty_items
                SELECT scope_key,
                       CASE WHEN OLD.resource_type IN ('checkpoint', 'checkpoints', 'loras', 'embeddings', 'hypernetworks', 'control_nets', 'ip_adapters', 'vaes', 'upscalers', 'clip_visions', 'detectors')
                            THEN 'facet_resource' ELSE 'full' END,
                       CASE OLD.resource_type WHEN 'checkpoint' THEN 'checkpoints' ELSE COALESCE(OLD.resource_type, '') END,
                       CASE WHEN OLD.resource_type IN ('checkpoint', 'checkpoints', 'loras', 'embeddings', 'hypernetworks', 'control_nets', 'ip_adapters', 'vaes', 'upscalers', 'clip_visions', 'detectors')
                            THEN COALESCE(OLD.name, '') ELSE '' END
                FROM invoke_scope_cache_state
                WHERE (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND NOT (
                      status = 'building'
                      AND scope_key = (SELECT active_scope_key FROM invoke_scope_cache_control WHERE state_key = 'current')
                      AND (SELECT suppress_active_model_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 1
                  )
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;
            ANALYZE image_vaes;
            ANALYZE image_upscalers;
            ANALYZE image_clip_visions;
            ANALYZE image_detectors;
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration86;

    #[test]
    fn every_supporting_model_table_has_scope_triggers_and_joins_the_image_update_union() {
        let sql = migration86().sql;
        for (facet, table) in [
            ("vaes", "image_vaes"),
            ("upscalers", "image_upscalers"),
            ("clip_visions", "image_clip_visions"),
            ("detectors", "image_detectors"),
        ] {
            assert!(sql.contains(&format!("CREATE TABLE IF NOT EXISTS {table}")));
            for suffix in ["insert_dirty", "update_dirty", "delete_dirty", "insert_detail", "update_detail", "delete_detail"] {
                assert!(sql.contains(&format!("CREATE TRIGGER invoke_scope_cache_{facet}_{suffix} AFTER")), "{facet} {suffix}");
            }
            assert!(sql.contains(&format!("UNION SELECT '{facet}'")), "{facet} union");
        }
        assert!(!sql.contains("hypernetworks_insert_dirty"));
        assert_eq!(sql.matches("'ip_adapters', 'vaes', 'upscalers', 'clip_visions', 'detectors'").count(), 6);
    }
}
