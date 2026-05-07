/**
 * Lighom Meta Catalog Feed Server.
 * Serves the latest feed XML from R2.
 *
 * Endpoints:
 *   GET /            → meta-feed.xml
 *   GET /meta.xml    → meta-feed.xml
 *   GET /health      → JSON health check
 *   GET /status      → HTML dashboard (last 24 cron logs)
 */

const FEED_KEY = 'meta-feed.xml';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/health') return health(env);
    if (pathname === '/status') return status(env);
    if (pathname === '/' || pathname === '/meta.xml') return serveFeed(env, request);
    return new Response('Not Found', { status: 404 });
  },
};

async function serveFeed(env, request) {
  const obj = await env.FEEDS.get(FEED_KEY);
  if (!obj) {
    return new Response('Feed not yet generated. The next workflow run will produce it.',
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  // ETag conditional GET → 304
  const inm = request.headers.get('If-None-Match');
  if (inm && inm === obj.httpEtag) return new Response(null, { status: 304 });

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'ETag': obj.httpEtag,
      'Last-Modified': obj.uploaded.toUTCString(),
      'X-Variant-Count': obj.customMetadata?.['variant-count'] ?? 'unknown',
      'X-Generated-At':  obj.customMetadata?.['generated-at'] ?? 'unknown',
    },
  });
}

async function health(env) {
  const head = await env.FEEDS.head(FEED_KEY);
  if (!head) return Response.json({ status: 'no_feed' }, { status: 503 });
  const ageHours = +((Date.now() - head.uploaded.getTime()) / 3_600_000).toFixed(2);
  const healthy = ageHours <= 6;
  return Response.json({
    status: healthy ? 'ok' : 'stale',
    age_hours: ageHours,
    size_mb: +(head.size / 1024 / 1024).toFixed(2),
    variant_count: head.customMetadata?.['variant-count'],
    generated_at:  head.customMetadata?.['generated-at'],
    healthy,
  }, { status: healthy ? 200 : 503 });
}

async function status(env) {
  const head = await env.FEEDS.head(FEED_KEY);
  const list = await env.FEEDS.list({ prefix: 'logs/', limit: 1000 });
  // newest first
  const recent = list.objects.sort((a, b) => b.key.localeCompare(a.key)).slice(0, 24);
  const logs = [];
  for (const o of recent) {
    const body = await env.FEEDS.get(o.key);
    if (!body) continue;
    try { logs.push(JSON.parse(await body.text())); } catch {}
  }
  const html = `<!doctype html><html lang=en><meta charset=utf-8>
<title>Lighom Meta Feed Status</title>
<style>
body{font:14px/1.5 system-ui;margin:2em auto;max-width:980px;padding:0 1em;color:#222}
h1{margin:0 0 .3em}h2{margin:1.5em 0 .5em;font-size:18px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:6px 10px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}
th{background:#f8f8f8}
.ok{color:#0a7}.fail{color:#c33}
.box{border:1px solid #ddd;padding:1em;border-radius:6px;margin:.5em 0}
code{background:#f4f4f4;padding:1px 4px;border-radius:3px}
</style>
<h1>Lighom Meta Catalog Feed</h1>
<div class=box>
<b>Latest:</b> ${head ?
  `${head.customMetadata?.['variant-count'] ?? '?'} variants · ${(head.size/1048576).toFixed(1)} MB · ${head.customMetadata?.['generated-at'] ?? '?'}`
  : '<span class=fail>NOT YET GENERATED</span>'}
<br><b>Feed:</b> <code>https://feed.lighom.com/meta.xml</code>
<br><b>Health:</b> <a href=/health>/health</a>
</div>
<h2>Last ${logs.length} runs</h2>
<table><thead><tr><th>Timestamp</th><th>Result</th><th>Variants</th><th>Size MB</th><th>Duration</th><th>Note / error</th></tr></thead><tbody>
${logs.map(l => `<tr>
<td>${l.timestamp ?? '-'}</td>
<td class="${l.success ? 'ok' : 'fail'}">${l.success ? '✓ OK' : '✗ FAIL'}</td>
<td>${l.variantCount ?? '-'}</td>
<td>${l.feedSize ? (l.feedSize/1048576).toFixed(1) : '-'}</td>
<td>${l.durationMs ? (l.durationMs/1000).toFixed(0)+'s' : '-'}</td>
<td>${(l.note ?? l.error ?? (l.errors||[]).join('; ')).toString().slice(0, 200)}</td>
</tr>`).join('')}
</tbody></table>
<p style=color:#888>Refresh to update.</p>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
