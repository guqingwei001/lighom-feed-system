/**
 * Bot detection for /capi/event and /capi/order requests.
 *
 * Scope: only filters events arriving at the Worker. JS-running bots from
 * datacenters (Meta crawler, Pinterest validator, AhrefsBot headless mode etc)
 * still hit gtag and our pixel, so this is the chokepoint where we can drop
 * them before they pollute Meta/Pinterest/Google CAPI EMQ scoring.
 *
 * Three signals (all from Cloudflare's free `request.cf` + headers):
 *   1. UA pattern   — known bot User-Agent strings
 *   2. ASN match    — known datacenter / cloud / Meta-DC ASNs
 *   3. CF threatScore — Cloudflare's free abuse signal (0=clean, 100=threat)
 *
 * Detection result drives two behaviors in the caller:
 *   - bot.is_bot=true  → fanout to Meta/Pinterest/Google CAPI is SKIPPED
 *                       (don't pollute pixel signal / EMQ score)
 *   - bot row is still written to BQ with is_bot=true so we can analyze
 *
 * Returns: { is_bot: bool, reason: string, ua_match: bool, asn_match: bool, threat: int }
 */

// Verified bot UA patterns. All are case-insensitive substring matches.
// Order: most common first (early exit on match).
const BOT_UA_PATTERNS = [
  // Meta — these access ad creative validation, OG scrape, IG link preview
  'facebookexternalhit', 'meta-externalagent', 'facebookbot', 'whatsapp',
  // Search engines — should never trigger CAPI events but they sometimes run JS now
  'googlebot', 'bingbot', 'applebot', 'duckduckbot', 'yandexbot', 'baiduspider',
  // Pinterest's own validator
  'pinterest', 'pinterestbot',
  // SEO crawlers
  'ahrefsbot', 'semrushbot', 'mj12bot', 'dotbot', 'rogerbot', 'screaming frog',
  'sitebulb', 'serpstatbot', 'seokicks', 'majestic', 'blexbot',
  // Generic / scraping
  'headlesschrome', 'phantomjs', 'puppeteer', 'playwright', 'selenium',
  'wget', 'curl/', 'python-requests', 'go-http-client', 'okhttp',
  'nodefetch', 'axios/', 'libwww', 'java/', 'apachebench',
  // Monitoring / uptime — not malicious but also not customers
  'uptimerobot', 'pingdom', 'newrelicpinger', 'statuscake',
  // Generic bot/spider/crawler tokens
  ' bot/', ' bot ', '/bot ', 'spider', 'crawler', 'scraper',
];

// ASN blocklist — datacenter / cloud / Meta DC. Sourced from public ASN registries.
// Format: numeric ASN. Add aggressively; risk is filtering a customer using a VPN
// (rare for Lighom's customer base, since most are residential US/CA/AU/GB shoppers).
const BOT_ASNS = new Set([
  // === Meta / Facebook ===
  32934,                        // Facebook
  // === AWS ===
  16509, 14618, 39111, 17493,   // AWS US/EU/Asia
  // === Google Cloud ===
  15169, 19527, 36492, 396982,  // Google + GCP
  // === Microsoft / Azure ===
  8075, 8068, 8074,             // Microsoft + Azure
  // === Cloudflare ===
  13335,
  // === DigitalOcean ===
  14061, 200130,
  // === Hetzner ===
  24940,
  // === OVH ===
  16276,
  // === Linode / Akamai Cloud ===
  63949, 20940, 16625, 12222,
  // === Vultr ===
  20473,
  // === Hydro66 (Norrbotten Sweden DC) ===
  47366,
  // === Oracle Cloud ===
  31898, 7160,
  // === Alibaba Cloud ===
  45102, 37963,
  // === Tencent Cloud ===
  132203, 45090,
  // === Fastly ===
  54113,
  // === Apple ===
  6185, 714,
  // === Internet Archive ===
  7941,
  // === Common datacenter providers ===
  62567, 35540, 51852, 42893, 24875, // Misc EU/US datacenter
]);

// Country ASN combinations that should NEVER serve real Lighom buyers. e.g.
// Norrbotten County Sweden (Hydro66 DC region) had 9.5K "users" in 2 days —
// those are not real customers. Adjust if you actually serve that region.
const SUSPICIOUS_GEO_HINTS = [
  // Format: country|region (lowercased substring match on `cf.country` + `cf.region`)
  // Add only when traffic from this combo is statistically all bots in your data.
];

const THREAT_SCORE_BOT_THRESHOLD = 30;   // CF free signal; 0=clean, 100=clear threat

/**
 * @param {Request} request
 * @returns {{ is_bot: boolean, reason: string, ua_match: boolean, asn_match: boolean, threat: number, asn: number }}
 */
export function detectBot(request) {
  const ua = (request.headers.get('User-Agent') || '').toLowerCase();
  const cf = request.cf || {};
  const asn = Number(cf.asn) || 0;
  const threat = Number(cf.threatScore) || 0;

  // 1) UA match
  let ua_match = false;
  let ua_hit = '';
  for (const pat of BOT_UA_PATTERNS) {
    if (ua.includes(pat)) { ua_match = true; ua_hit = pat; break; }
  }

  // 2) ASN match
  const asn_match = asn > 0 && BOT_ASNS.has(asn);

  // 3) Cloudflare verified bot signal (set by CF's free bot detection)
  // request.cf.botManagement.verifiedBot is true for Google/Bing/Pinterest verified crawlers
  const cf_verified_bot = cf.botManagement && cf.botManagement.verifiedBot === true;

  // 4) Threat score signal
  const threat_high = threat >= THREAT_SCORE_BOT_THRESHOLD;

  // 5) Suspicious geo hints (optional — skipped if list empty)
  let geo_match = false;
  if (SUSPICIOUS_GEO_HINTS.length) {
    const country = (cf.country || '').toLowerCase();
    const region = (cf.region || '').toLowerCase();
    const tag = `${country}|${region}`;
    geo_match = SUSPICIOUS_GEO_HINTS.some((h) => tag.includes(h.toLowerCase()));
  }

  const is_bot = ua_match || asn_match || cf_verified_bot || threat_high || geo_match;
  let reason = '';
  if (ua_match)         reason = `ua:${ua_hit}`;
  else if (asn_match)   reason = `asn:${asn}`;
  else if (cf_verified_bot) reason = 'cf_verified_bot';
  else if (threat_high) reason = `threat_score:${threat}`;
  else if (geo_match)   reason = 'suspicious_geo';

  return { is_bot, reason, ua_match, asn_match, threat, asn };
}
