/* Shared crypto helpers — used by capi.js, events.js, pinterest.js.
   Canonical sha256Hex: lowercase hex output. Caller is responsible for input
   normalization (lowercase/trim). Function body verified equivalent across
   3 prior local definitions (capi.js / events.js / pinterest.js as pinSha256)
   before consolidating 2026-05-31 Phase D1. */
export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
