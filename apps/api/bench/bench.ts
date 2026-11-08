/**
 * `pnpm --filter api bench` runs autocannon scenarios against a running API seeded with
 * `db:seed:bulk 10000`, and prints p50/p95/p99 latency, throughput and response size against
 * the budgets in spec 6.7.6. BENCH_URL defaults to http://localhost:3000/api/v1.
 */
import autocannon from 'autocannon';

const base = process.env.BENCH_URL ?? 'http://localhost:3000/api/v1';
const duration = Number(process.env.BENCH_DURATION ?? 10);

async function json(path: string, init?: RequestInit) {
  const res = await fetch(base + path, init);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return { body: await res.json(), bytes: Number(res.headers.get('content-length') ?? 0) || (await Promise.resolve(0)) };
}

async function run(name: string, path: string, token?: string, budgetMs?: number) {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  const result = await autocannon({ url: base + path, connections: 50, duration, headers });
  const l = result.latency;
  const ok = budgetMs === undefined || l.p97_5 <= budgetMs;
  console.log(
    `${name.padEnd(34)} p50 ${l.p50} ms  p97.5 ${l.p97_5} ms  p99 ${l.p99} ms  ${Math.round(result.requests.average)} req/s  non2xx ${result.non2xx}` +
      (budgetMs ? `  [budget ${budgetMs} ms: ${ok ? 'OK' : 'OVER'}]` : ''),
  );
  return result;
}

async function main() {
  const login = await json('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: 'password' }),
  });
  const token = login.body.accessToken as string;

  // Walk to the deepest page to get a cursor near the oldest row.
  let cursor: string | null = null;
  let deepCursor: string | null = null;
  let pages = 0;
  let raw = '';
  do {
    const res = await fetch(`${base}/photos?limit=60${cursor ? `&cursor=${cursor}` : ''}`, { headers: { authorization: `Bearer ${token}` } });
    const body = (await res.json()) as { nextCursor: string | null };
    deepCursor = cursor ?? deepCursor;
    cursor = body.nextCursor;
    pages++;
  } while (cursor);
  raw = await (await fetch(`${base}/photos?limit=24`, { headers: { authorization: `Bearer ${token}`, 'accept-encoding': 'identity' } })).text();
  console.log(`Walked ${pages} pages of 60. Response size for 24 items (uncompressed, with flags): ${(raw.length / 1024).toFixed(1)} KB (budget < 12 KB)\n`);

  await run('GET /photos (guest, cached)', '/photos?limit=24');
  const first = await run('GET /photos (user, uncached)', '/photos?limit=24', token, 30);
  const deep = await run('GET /photos deep page (uncached)', `/photos?limit=24&cursor=${deepCursor}`, token, 30);
  await run('GET /me/favorites', '/me/favorites?limit=24', token, 40);
  const ratio = deep.latency.p50 / Math.max(first.latency.p50, 0.01);
  console.log(`\nDeep vs first page p50 ratio: ${ratio.toFixed(2)} (budget within 20%)`);
  console.log(`Uncached throughput: ${Math.round(first.requests.average)} req/s (budget >= 500)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
