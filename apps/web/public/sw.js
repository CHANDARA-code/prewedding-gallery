/*
 * Pre-Wedding View service worker: keeps photos on the device so repeat visits and swiping back and
 * forth don't hit the server again.
 *
 * - /uploads/thumbs/* and /uploads/previews/*: cache-first. File names are random UUIDs and a new
 *   rendering (e.g. after a rotation) gets a new name, so a cached file is never stale.
 *   Each cache is capped (oldest entries evicted) so it can't grow without bound.
 * - /assets/*: cache-first (content-hashed build files).
 * - Page loads: network-first, falling back to the last page shell when offline.
 * - API requests and originals are left to the network / HTTP cache.
 */
const CACHES = {
  thumbs: { name: 'pw-thumbs-v1', limit: 3000 }, // ~40 KB each
  previews: { name: 'pw-previews-v1', limit: 400 }, // ~300 KB each
  shell: { name: 'pw-shell-v1', limit: 60 },
};
const KEEP = new Set(Object.values(CACHES).map((c) => c.name));
const SHELL_KEY = '/__shell';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (!KEEP.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

const puts = new Map();
async function trim(cfg) {
  const n = (puts.get(cfg.name) ?? 0) + 1;
  puts.set(cfg.name, n);
  if (n % 25 !== 0) return; // trimming lists every key: do it every 25 writes, not every write
  const cache = await caches.open(cfg.name);
  const keys = await cache.keys(); // insertion order: oldest first
  for (const req of keys.slice(0, Math.max(0, keys.length - cfg.limit))) await cache.delete(req);
}

async function cacheFirst(request, cfg) {
  const cache = await caches.open(cfg.name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone()).catch(() => undefined); // quota errors are not fatal
    trim(cfg).catch(() => undefined);
  }
  return response;
}

async function networkFirstPage(event) {
  const cache = await caches.open(CACHES.shell.name);
  try {
    const response = await fetch(event.request);
    if (response.ok && (response.headers.get('content-type') ?? '').includes('text/html')) event.waitUntil(cache.put(SHELL_KEY, response.clone()).catch(() => undefined));
    return response;
  } catch (err) {
    const shell = await cache.match(SHELL_KEY);
    if (shell) return shell;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (path.startsWith('/uploads/thumbs/')) event.respondWith(cacheFirst(request, CACHES.thumbs));
  else if (path.startsWith('/uploads/previews/')) event.respondWith(cacheFirst(request, CACHES.previews));
  else if (path.startsWith('/assets/')) event.respondWith(cacheFirst(request, CACHES.shell));
  else if (request.mode === 'navigate' && !path.startsWith('/api/') && !path.startsWith('/uploads/')) {
    event.respondWith(networkFirstPage(event));
  }
});
