/**
 * Supporting models a generation loads beside its checkpoint. Each one is its own Assets section,
 * filter, and facet, stored in its own junction table (migration 86). `hashPrefix` matches the
 * Rust facet harvest (db/facets.rs) for assets that have no real file hash.
 */
export const SUPPORTING_MODEL_TYPES = [
    { key: 'vaes', searchPrefix: 'vae:', hashPrefix: 'vae_', cacheType: 'vaes', table: 'image_vaes', column: 'vae_name', label: 'VAEs', singular: 'VAE' },
    { key: 'upscalers', searchPrefix: 'upscaler:', hashPrefix: 'upsc_', cacheType: 'upscalers', table: 'image_upscalers', column: 'upscaler_name', label: 'Upscale Models', singular: 'Upscale Model' },
    { key: 'clipVisions', searchPrefix: 'clipvision:', hashPrefix: 'clipv_', cacheType: 'clip_visions', table: 'image_clip_visions', column: 'clip_vision_name', label: 'CLIP Vision', singular: 'CLIP Vision Model' },
    { key: 'detectors', searchPrefix: 'detector:', hashPrefix: 'det_', cacheType: 'detectors', table: 'image_detectors', column: 'detector_name', label: 'Detection Models', singular: 'Detection Model' },
] as const;

export type SupportingModelType = typeof SUPPORTING_MODEL_TYPES[number];
export type SupportingModelKey = SupportingModelType['key'];
export type SupportingModelCacheType = SupportingModelType['cacheType'];

export const SUPPORTING_MODEL_KEYS: readonly SupportingModelKey[] = SUPPORTING_MODEL_TYPES.map(type => type.key);

export const isSupportingModelKey = (value: string): value is SupportingModelKey =>
    (SUPPORTING_MODEL_KEYS as readonly string[]).includes(value);

export const getSupportingModelType = (key: SupportingModelKey): SupportingModelType =>
    SUPPORTING_MODEL_TYPES.find(type => type.key === key) as SupportingModelType;
