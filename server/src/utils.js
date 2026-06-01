/* Shared utils — used by capi.js, events.js (D2 consolidation, 5/31).
   settledOr: Promise.allSettled result → either fulfilled value or
   {ok:false, error} for rejected. Function body verified byte-identical
   across capi.js + events.js prior to consolidation. */
export function settledOr(s) {
  return s.status === 'fulfilled' ? s.value : { ok: false, error: String(s.reason).slice(0, 300) };
}
