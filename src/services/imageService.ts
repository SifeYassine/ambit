/**
 * Repairs asset URLs for Tauri compatibility.
 */
export const repairAssetUrl = (url: string): string => {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:')) return url;
    return url;
};
