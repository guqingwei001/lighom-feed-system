/**
 * BigQuery Streaming Insert client (Cloud Workers — pure Web Crypto, no deps).
 *
 * Authentication: Service Account JSON (env.GCP_SA_JSON) — RS256 JWT exchanged
 * at https://oauth2.googleapis.com/token for an access_token cached 55 min.
 *
 * Required env:
 *   GCP_SA_JSON      raw JSON of Service Account key file
 *   GCP_PROJECT_ID   e.g. "lighom-analytics"
 *
 * Usage:
 *   import { insertRow } from './bigquery.js';
 *   await insertRow(env, 'lighom_capi', 'orders', { event_id: '...', ...row }, 'INSERT_ID');
 *
 * Service Account roles required:
 *   - BigQuery Data Editor   (write rows)
 *   - BigQuery Job User      (streaming inserts)
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/bigquery.insertdata';

// Module-scoped cache (persists across requests in same isolate; Workers may
// scale across multiple isolates so cache hit rate < 100% — still saves >90%
// of token requests in steady state)
let cachedToken = null;
let cachedExpiry = 0;

export async function insertRow(env, dataset, table, row, insertId) {
  if (!env.GCP_SA_JSON || !env.GCP_PROJECT_ID) {
    throw new Error('BQ env missing: GCP_SA_JSON / GCP_PROJECT_ID');
  }
  const accessToken = await getAccessToken(env);
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${env.GCP_PROJECT_ID}/datasets/${dataset}/tables/${table}/insertAll`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      rows: [{ insertId: insertId || row.event_id, json: row }],
      skipInvalidRows: false,
      ignoreUnknownValues: false,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`BQ insertAll ${resp.status}: ${t.slice(0, 500)}`);
  }
  const data = await resp.json();
  if (data.insertErrors && data.insertErrors.length) {
    throw new Error(`BQ row errors: ${JSON.stringify(data.insertErrors).slice(0, 500)}`);
  }
  return { ok: true };
}

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedExpiry > now + 60) return cachedToken;

  let sa;
  try { sa = JSON.parse(env.GCP_SA_JSON); }
  catch (e) { throw new Error('GCP_SA_JSON is not valid JSON'); }
  if (!sa.client_email || !sa.private_key) {
    throw new Error('GCP_SA_JSON missing client_email / private_key');
  }

  const header = { alg: 'RS256', typ: 'JWT', kid: sa.private_key_id };
  const payload = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const eh = b64u(JSON.stringify(header));
  const ep = b64u(JSON.stringify(payload));
  const signingInput = `${eh}.${ep}`;
  const signature = await rsaSign(signingInput, sa.private_key);
  const jwt = `${signingInput}.${signature}`;

  const tokResp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  if (!tokResp.ok) {
    const t = await tokResp.text();
    throw new Error(`token exchange ${tokResp.status}: ${t.slice(0, 300)}`);
  }
  const tok = await tokResp.json();
  if (!tok.access_token) throw new Error('no access_token in response');
  cachedToken = tok.access_token;
  cachedExpiry = now + (tok.expires_in || 3600);
  return cachedToken;
}

async function rsaSign(input, pem) {
  const stripped = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(stripped), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(input),
  );
  return b64uFromBuf(sig);
}

function b64u(s) {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uFromBuf(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
