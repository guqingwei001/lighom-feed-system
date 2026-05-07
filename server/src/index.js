/**
 * Lighom Catalog Feed Server.
 * Serves feed XML files from a private R2 bucket, gated by FEED_ACCESS_TOKEN.
 *
 * Endpoints:
 *   GET /meta.xml?key=…       → meta-feed.xml      (token-gated)
 *   GET /pinterest.xml?key=…  → pinterest-feed.xml (token-gated)
 *   GET /google.xml?key=…     → google-feed.xml    (token-gated)
 *   GET /health               → JSON health (open — for monitoring)
 *   GET /status               → HTML dashboard (open — for monitoring)
 */

const FEED_ROUTES = {
  '/meta.xml':      'meta-feed.xml',
  '/pinterest.xml': 'pinterest-feed.xml',
  '/google.xml':    'google-feed.xml',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/health') return health(env);
    if (pathname === '/status') return status(env);

    const fileName = FEED_ROUTES[pathname];
    if (!fileName) return new Response('Not Found', { status: 404 });

    // Token gate
    const token = url.searchParams.get('key');
    if (!token || !env.FEED_ACCESS_TOKEN || !timingSafeEqual(token, env.FEED_ACCESS_TOKEN)) {
      return new Response('Forbidden', {
        status: 403,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    return serveFeed(env, request, fileName);
  },
};

// Constant-time string compare (mitigates timing-based token brute force)
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function serveFeed(env, request, fileName) {
  const obj = await env.FEEDS.get(fileName);
  if (!obj) {
    return new Response('Feed not yet generated. The next workflow run will produce it.',
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
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
  const out = {};
  for (const [route, file] of Object.entries(FEED_ROUTES)) {
    const head = await env.FEEDS.head(file);
    if (!head) {
      out[route.replace(/^\/|\.xml$/g, '')] = { exists: false };
      continue;
    }
    const ageHours = +((Date.now() - head.uploaded.getTime()) / 3_600_000).toFixed(2);
    out[route.replace(/^\/|\.xml$/g, '')] = {
      exists: true,
      age_hours: ageHours,
      size_mb: +(head.size / 1024 / 1024).toFixed(2),
      variant_count: head.customMetadata?.['variant-count'],
      generated_at:  head.customMetadata?.['generated-at'],
      healthy: ageHours <= 6,
    };
  }
  const anyHealthy = Object.values(out).some(v => v.healthy);
  return Response.json({
    status: anyHealthy ? 'ok' : 'no_active_feed',
    feeds: out,
  }, { status: anyHealthy ? 200 : 503 });
}

async function status(env) {
  const list = await env.FEEDS.list({ prefix: 'logs/', limit: 1000 });
  const recent = list.objects.sort((a, b) => b.key.localeCompare(a.key)).slice(0, 24);
  const logs = [];
  for (const o of recent) {
    const body = await env.FEEDS.get(o.key);
    if (!body) continue;
    try { logs.push(JSON.parse(await body.text())); } catch {}
  }
  const heads = {};
  for (const [route, file] of Object.entries(FEED_ROUTES)) {
    heads[route] = await env.FEEDS.head(file);
  }
  const html = `<!doctype html><html lang=en><meta charset=utf-8>
<title>Lighom Catalog Feed Status</title>
<style>
body{font:14px/1.5 system-ui;margin:2em auto;max-width:980px;padding:0 1em;color:#222}
h1{margin:0 0 .3em}h2{margin:1.5em 0 .5em;font-size:18px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:6px 10px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}
th{background:#f8f8f8}
.ok{color:#0a7}.fail{color:#c33}.miss{color:#999}
.box{border:1px solid #ddd;padding:1em;border-radius:6px;margin:.5em 0}
code{background:#f4f4f4;padding:1px 4px;border-radius:3px}
</style>
<h1>Lighom Catalog Feed</h1>
<div class=box>
<b>Feeds (token-gated, append <code>?key=…</code> to access):</b>
<ul>
${Object.entries(heads).map(([route, h]) => `<li><code>${route}</code> — ${h ? `${h.customMetadata?.['variant-count'] ?? '?'} variants · ${(h.size/1048576).toFixed(1)} MB · ${h.customMetadata?.['generated-at'] ?? '?'}` : '<span class=miss>not generated yet</span>'}</li>`).join('')}
</ul>
</div>
<h2>Last ${logs.length} runs (all feeds)</h2>
<table><thead><tr><th>Timestamp</th><th>Feed</th><th>Result</th><th>Variants</th><th>Size MB</th><th>Duration</th><th>Note / error</th></tr></thead><tbody>
${logs.map(l => `<tr>
<td>${l.timestamp ?? '-'}</td>
<td>${l.feed ?? 'meta'}</td>
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
