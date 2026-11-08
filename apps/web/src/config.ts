const trimSlash = (s: string) => s.replace(/\/+$/, '');

/** API base. Unset means same origin (production: the API serves this build). */
export const API_URL = trimSlash(import.meta.env.VITE_API_URL || '/api/v1');

/** Origin for `/uploads/*`. Empty means same origin. */
export const ASSET_URL = trimSlash(import.meta.env.VITE_ASSET_URL || '');

export const assetUrl = (path: string) => (/^https?:\/\//.test(path) ? path : `${ASSET_URL}${path}`);

export const PAGE_SIZE = 24;
