import type { Request, Response } from 'express';

/** Public lists/detail: shared-cacheable for guests, private for token holders (spec 6.7.3). */
export function setPublicCacheHeaders(req: Request, res: Response) {
  res.setHeader('Vary', 'Authorization');
  res.setHeader(
    'Cache-Control',
    req.headers.authorization ? 'private, no-cache' : 'public, max-age=30, stale-while-revalidate=60',
  );
}

export function setNoStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
}
