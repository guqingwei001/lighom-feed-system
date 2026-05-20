# Lighom Shopline Custom Code Blocks — Architecture Map

**Last audit: 2026-05-20** | **Total: 31 enabled** | **git baseline: `abc138c` (full code snapshot)**

This map exists so the next person (including future self) doesn't repeat the v8 event_id regression (2026-05-15 incident: a "small fix" silently changed `purchase_<orderSeq>` → `purchase_<appOrderSeq>` and broke Meta dedup). **Read this before touching any block.**

---

## 🚨 Load Order Constraints (MUST NOT BREAK)

Shopline custom code position=`top` blocks load in roughly the **order they were created** (the API has no explicit priority field). The following invariants depend on this:

1. **Bot Guard v1 MUST run first** — it defines `window.LIGHOM_SELF_PIXEL_LIVE` flag and `window.__lighomIsBot`. All self-pixel/self-pin blocks `_gateRetry` on these. (Created 2026-05-19, oldest of the new tracking system → loads first.)

2. **Util Lib v1 MUST run before any self-pixel/self-pin event block** — they all `return setTimeout(_gateRetry, 30)` if `window.LighomUtil` is undefined. (Created 2026-05-19, before event blocks.)

3. **User Data Enricher v10 ↔ Self Pixel Base v1 race exists**: Base init runs synchronously at load (`fbq('init', PIXEL_ID, collectHashedPII())`), but Enricher's first scanDOM may not have populated `_lighom_user_*_h` cookies yet. First-visit users get empty PII in fbq init. See known bug #2 below.

4. **Self Pixel Base + Self Pin Base must run before** their respective event blocks (they load `fbevents.js` + `pintrk core.js`). If event block fires before base loaded, fbq/pintrk are queue-only (Pinterest SDK drains queue when loaded; Meta fbq() falls back to queue) — usually fine, occasionally lossy.

---

## 📐 Dependency Graph

```
                    ┌──────────────────────────────┐
                    │  Bot Guard v1                │
                    │  - sets LIGHOM_SELF_PIXEL_LIVE
                    │  - sets __lighomIsBot         │
                    │  - bot path: noop fbq/pintrk  │
                    └─────────┬────────────────────┘
                              │ (LIVE flag + isBot consumed by ↓)
            ┌─────────────────┴─────────────────┐
            │                                   │
   ┌────────▼────────┐                ┌────────▼─────────┐
   │ User Data       │                │ Util Lib v1      │
   │ Enricher v10    │                │ (reader only)    │
   │ (PII writer +   │                │ - collectHashed  │
   │  scanDOM +      │                │ - buildUserData  │
   │  SHA256 +       │                │ - logErr         │
   │  cookie writer  │                │                  │
   │  + pintrk hijack│                │ READS from       │
   │  + AAM init +   │                │ _lighom_user_*_h │
   │  EM set +       │                │ cookies          │
   │  gtag set +     │                │ (Enricher writes)│
   │  GA4 DL bridge) │                └──────────────────┘
   └────────┬────────┘                          ▲
            │ writes cookies _lighom_user_<f>_h │
            │ also writes window.__lighom_user_data_hashed
            └────────────────────┬──────────────┘
                                 │
              ┌──────────────────┴──────────────────┐
              │                                     │
     ┌────────▼────────┐                  ┌────────▼─────────┐
     │ Self Pixel v2   │                  │ Self Pin v1      │
     │ (FB-only, 9    │                  │ (Pin-only, 6     │
     │  event blocks) │                  │  event blocks)   │
     │ - Base (init)  │                  │ - Base (load)    │
     │ - PV/VC/VCat/  │                  │ - PV/VCat/       │
     │   ATC/IC/      │                  │   ATC/Purchase/  │
     │   APInfo/      │                  │   Search         │
     │   Purchase/    │                  │                  │
     │   Search       │                  │ (each calls      │
     │                │                  │  Util Lib +      │
     │ (each calls    │                  │  reads cookies)  │
     │  Util Lib +    │                  │                  │
     │  reads cookies)│                  │                  │
     └────────────────┘                  └──────────────────┘
                  └────────┐    ┌────────┘
                          ▼     ▼
                     Worker /capi/event
                     (Meta CAPI + Pinterest CAPI + GA4 MP + BQ)
```

---

## 📦 31 Enabled Blocks — Inventory

### A. Self Pixel v2 series (FB) — 9 blocks, all LIVE-gated + `_gateRetry`
| ID | Name | Scope | Code |
|---|---|---|---|
| `7531635329926958110` | Self Pixel — Base v1 | ALL | fbq init + AAM from Util Lib |
| `7531643760779986056` | Self Pixel — PageView v2 | ALL | fbq PV + Worker;`__extReady` 6s timeout |
| `7531645191020874785` | Self Pixel — ViewContent v2 | PRODUCT_DETAIL | fbq VC, variant-aware, 3s debounce on variant change |
| `7531672974174456873` | Self Pixel — ViewCategory v2 | PRODUCT_LIST, ALLCOLLECTIONS | fbq VC + content_type='product_group';DL/DOM fallback |
| `7531652117880376355` | Self Pixel — AddToCart v2 | PRODUCT_DETAIL, CART | fbq ATC, click + `/cart/add` fetch hook;1.5s same-sku dedup |
| `7531653989747917962` | Self Pixel — IC v2 | SETTLE_PAGE | fbq IC, stable per-session event_id, cart.js fallback |
| `7531671032429806735` | Self Pixel — APInfo v2 | SETTLE_PAGE | fbq APInfo, email blur trigger |
| `7531671835303480359` | Self Pixel — Purchase v2 | SETTLE_PAGE, ORDERS | fbq Purchase + localStorage cross-session lock per orderSeq;event_id=`purchase_<appOrderSeq>` aligned with Worker capi.js:458 |
| `7531672379757692049` | Self Pixel — Search v2 | SEARCH_RESULT | fbq Search from `?q=` |

### B. Self Pin v1 series (Pinterest) — 6 blocks, all LIVE-gated + `_gateRetry`
| ID | Name | Scope | Code |
|---|---|---|---|
| `7531681417878834220` | Self Pin — Base v1 | ALL | pintrk load + Enhanced Match (em/ph/fn/ln/ct/st/zp/country/external_id/ge — no db) |
| `7531682058349055022` | Self Pin — PageView v1 | ALL | pintrk pagevisit;`__extReady` 6s timeout |
| `7531696014560070712` | Self Pin — ViewCategory v1 | PRODUCT_LIST, ALLCOLLECTIONS | pintrk viewcategory + line_items;🔴 **bug: line 71 `getIdsFromDOM()` undefined** |
| `7531686784088149040` | Self Pin — AddToCart v1 | PRODUCT_DETAIL, CART | pintrk addtocart, click + fetch hook (sentinel `__lighom_atc_pin_hooked`) |
| `7531694803865832502` | Self Pin — Purchase v1 | SETTLE_PAGE, ORDERS | pintrk checkout + localStorage lock per orderSeq |
| `7531695369593554067` | Self Pin — Search v1 | SEARCH_RESULT | pintrk search from `?q=` |

### C. PII / Tracking Infrastructure — 4 blocks
| ID | Name | Scope | Critical role |
|---|---|---|---|
| `7531588837493179522` | Bot Guard v1 | ALL | 🔴 **LIVE flag def + isBot guard. MUST RUN FIRST.** noop fbq/pintrk for bots, short-circuits Worker fetch |
| `7531852299762928771` | Self Pixel Util Lib v1 | ALL | Reader: ck/hxOnly/lsClick/collectHashedPII/buildUserData/logErr. Reads cookies `_lighom_user_<f>_h` (Enricher writes them) |
| `7511372181517110800` | User Data Enricher v10 | ALL | 🔴 **5 subsystems mashed (don't touch lightly):**<br>1. PII writer: scanDOM 10 fields + SHA256 + writes `_lighom_user_<f>_h` cookies (365d) + `window.__lighom_user_data_hashed`<br>2. Pinterest pintrk hijack v3: queue intercept + 10s re-install loop + stable event_id<br>3. fbq init AAM (overlaps Self Pixel Base)<br>4. pintrk Enhanced Match<br>5. gtag Enhanced Conversions<br>+ device UUID fallback for external_id<br>+ dataLayer bridge for GA4 ecommerce events |
| `7513521457139551854` | EMQ Events (Subscribe+Lead+TOP-Pixel) | ALL | fbq Subscribe + Lead from form submit. Dead code: TimeOnPage bridge (line 82-94) — TimeOnPage v6 no longer dataLayer pushes `time_on_page_<N>s` (uses gtag direct) |

### D. Click / Event-ID / Cart Utility — 4 blocks
| ID | Name | Scope | Role |
|---|---|---|---|
| `7509024059428179441` | Event ID Injector v2 | ALL | (1) dataLayer.push hijack: injects event_id. (2) pintrk hijack: **dead segment** — Enricher's pintrk hijack v3 wraps innermost and overwrites event_id last. Verify load-order assumption before deleting |
| `7513393888977225380` | Capture All Click IDs v3.1 | ALL | Cookie↔localStorage sync for fbclid/gclid/wbraid/gbraid/epik/ttclid/msclkid + UTM first/last. Bootstraps _fbp/_fbc (idempotent overlap with Enricher) |
| `7514853698952236714` | Variant Link Injector v2 | ALL | `/products/<handle>` link → variant URL via cached sku. 2026-05-20 B-fix removed fetch-block click delay (line 89-92) — cache-hit path active, cache-miss path is now no-op |
| `7513535876166848112` | Cart Attributes Injector v1 | ALL | POST `/cart/update.js` cart attributes (fbc/fbp/ua/utm/click ids) for downstream attribution |

### E. Telemetry / Engagement — 3 blocks
| ID | Name | Scope | Role |
|---|---|---|---|
| `7523261972315639689` | Web Vitals RUM v1.2 | ALL | LCP/CLS/INP/FCP/TTFB → gtag + Worker. event_id encodes value: `wv_<metric>_<value-int>_<rating>_<ts>_<rand>` (BQ extracts via SPLIT[OFFSET(2)]) |
| `7509123252083754546` | Engagement Signals | ALL | (1) DeepEngagement: scroll ≥75% + time ≥60s on PDP → fbq trackCustom + Worker. (2) Cart items cache: dataLayer hijack capturing add_to_cart items. (3) Contact event: tel:/mailto: click → fbq track Contact |
| `7509058371888352757` | TimeOnPage v6 | ALL | 60s on PDP/collection → gtag direct (NOT dataLayer push — that's why EMQ Events bridge is dead). 180s on PDP → Worker fanout=[meta,pinterest] + gtag mirror, localStorage cross-session lock |

### F. Lifecycle — 1 block
| ID | Name | Scope | Role |
|---|---|---|---|
| `7509057370439552499` | CompleteRegistration v2 | ALL | Register form submit → sessionStorage → on next pageload fires fbq + Worker |

### G. 3rd Party / Loader — 4 blocks
| ID | Name | Scope | Role |
|---|---|---|---|
| `7508752885880194595` | GA4 Loader | ALL | DNS prefetch + preconnect to FB/GTM/GA/Pin/Worker + gtag.js `G-0K0Q3MV1JE` |
| `7517314185354809070` | Microsoft Clarity | ALL | Clarity init `woskuen8hr` + page_type tag + identify(external_id) |
| `7447758265469636644` | Trustpilot | ALL | Trustpilot widget loader (`QMaQnxYt6JIDjNNO`) |
| `7526514548230325261` | Recs Hide (temp) | ALL | CSS `.lighom-recs{display:none}`. ⚠️ name says "temp" — verify if still used before removing |

---

## 🐛 Known Bugs (P0–P3)

### P0 — Production crashes (fix first)
| Block | Bug | Symptom |
|---|---|---|
| Self Pin ViewCategory v1, line 71 | `getIdsFromDOM()` undefined function reference (function was removed but call wasn't) | ReferenceError thrown when DL has no `view_category` data → rest of `fire()` doesn't execute → no pintrk viewcategory + no Worker fanout for that visit. **Likely contributor to ViewCategory 13% missing rate.** |

### P1 — Tracked named projects (don't lose, don't rush)
| Issue | Tracked task |
|---|---|
| external_id 51.8% race on first-visit PV | Task #73. Root cause: Self Pixel Base v1 line 24 sync `fbq('init', PIXEL_ID, collectHashedPII())` runs before Enricher's first scanDOM + SHA256 + cookie write → first PV's fbq init has empty AAM. Race fix necessarily touches Base + Enricher timing. **NOT "极高风险所以永不修" — independent session, full baseline + verify**. |

### P2 — Dead code (delete after each independently verifies)
| Block | Dead segment | Verification before delete |
|---|---|---|
| Self Pixel Purchase v2, line 65-73 | `rawEm/rawPh/rawFn/rawLn/rawCt/rawSt/rawZp/rawCountry/rawExtId` declared but never used in fanout payload | grep block for any reference to those vars; confirm `ud = LighomUtil.buildUserData()` is the only PII source in the payload |
| Self Pin Purchase v1, line 62-71 | Same dead vars as above | Same |
| EMQ Events, line 82-94 | TimeOnPage bridge listening for dataLayer `{event:'time_on_page_<N>s'}` | TimeOnPage v6 uses gtag direct, not dataLayer push of that shape → bridge never matches. Safe to delete after EMQ + CR merge. |
| Event ID Injector v2, line 41-128 | pintrk hijack segment | Enricher's pintrk hijack v3 wraps innermost; event_id overwrite at line 117 wins. **Verify load order is stable**:comment out + 24h, watch Pinterest event_id dedup before truly deleting. |

### P3 — Redundancies (working but wasteful)
- 3 chained `dataLayer.push` hijacks (Enricher → Event ID Injector → Engagement Signals). Performance overhead, no functional conflict. Could consolidate if any of them is rewritten.
- `_fbp/_fbc` bootstrap duplicated: User Data Enricher line 35-46 + Capture Click IDs line 68-72. Both check cookie before write, idempotent. No-op cost.
- fbq init duplicated: Self Pixel Base + Enricher both call `fbq('init', PIXEL_ID, ...)`. Meta supports multi-init (just updates AAM). Connected to P1 race.

---

## 🔑 Critical Invariants (DO NOT BREAK)

### Event ID Contracts (cross-block + cross-pipeline dedup)
- **Purchase**: `purchase_<appOrderSeq>` — must align Self Pixel Purchase v2 + Self Pin Purchase v1 + Worker `capi.js:458` (fired from Shopline webhook). Mismatch → Meta/Pin double-count. 2026-05-15 v8 broke this by switching to `purchase_<orderSeq>` (numeric);**fixed 2026-05-20**.
- **InitiateCheckout**: per-session stable via `sessionStorage['lighom_ic_v2_event_id']` (key=`ic_<cart.token>_<rand>`)
- **AddToCart**: `atc_<sku>_<now>` — non-stable across sessions but 1.5s same-sku dedup blocks bursts
- **PageView**: `pv_<ts>_<rand>` — different ID across blocks (Self Pixel PV v2 vs Self Pin PV v1 generate independently). Cross-platform dedup NOT possible — Meta and Pinterest each receive their own event independently.
- **Search**: `search_<qHash>_<ts>` — same risk as PageView (independent timestamps yield different IDs)
- **ViewContent**: `vc_<sku>_<pageloadSeed>` — pageloadSeed shared within page load only
- **ViewCategory**: `viewcat_<slug>_<ts>` — independent across blocks
- **Custom events** (DeepEngagement, Contact, TimeOnPage180s, WebVitals): per-event unique, no dedup needed

### Cookie Contracts (PII pipeline)
- **`_lighom_user_<f>_h`** (where f ∈ em/ph/fn/ln/ct/st/zp/country/db/ge/external_id) — Enricher writes (line 405-408 with SHA256 + 365d + domain=lighom.com), Util Lib reads (line 17 `hxOnly(ck(P + f + "_h"))` requires 64-char hex). **Format**: SHA256-hashed normalized PII.
- **`_lighom_user_external_id`** (no `_h` suffix) — raw external_id fallback in Util Lib (line 23).
- **`_lighom_user_fb_login_id`** — raw fb_login_id (no `_h` suffix), passed-through.
- **`_fbp` / `_fbc`** — Meta standard, bootstrapped by both Enricher and Capture Click IDs (idempotent).

### Page Scope Conventions
- Most event blocks scope to specific pages (PRODUCT_DETAIL / SETTLE_PAGE / ORDERS / etc.) to avoid firing on irrelevant pages.
- ALL infrastructure blocks (Bot Guard, Util Lib, Enricher, Click IDs, GA4 Loader, Clarity, Trustpilot, RUM, Engagement Signals, TimeOnPage, CR, Cart Attrs, Variant Link, EMQ Events) — `allPageScope=true` since they're either utility or fire conditionally based on path matching internally.

---

## 🛠️ Operating Procedure for Future Changes

1. **Before any change**: GET current block via `/admin/api/website/plugin/admin/custom-code/<id>` and confirm code matches latest snapshot in `blocks/current_snapshot/`. **Don't trust local dump that's older than today.**

2. **After any change**: re-GET and `diff` against expected — verify code length, key contracts (event_id formula, cookie names, page scopes).

3. **For "dead code" removal**: comment-out + 24h monitor first; only delete after metric counts confirm no drop.

4. **For 1-event-1-block consolidation** (merging Self Pixel + Self Pin per event): blocked by user铁律 "FB/Pin 不合并" — don't attempt without explicit reversal.

5. **For User Data Enricher v10 changes**: it has 5 mashed-up subsystems. Pin which subsystem you're touching, treat each as independent change with its own verify window.

6. **For Self Pixel Base / fbq init timing**: this is P1 race territory. Don't touch without baseline + verify plan. See Task #73.

7. **Atomic rollouts**: new block enabled → old block paused → 24h monitor → DELETE old. For LIVE flag flips: Bot Guard line 24-26 is the single control point (`Math.random() < N` for gradient).

8. **DELETEd blocks live in git**: branch `lighom-feed-system`, baseline `abc138c` and forward. Files: `blocks/current_snapshot/<id>__<name>.js`.

---

## 📋 Audit History
| Date | Action |
|---|---|
| 2026-05-20 | **Baseline snapshot**: 35 blocks dumped to git, `abc138c` |
| 2026-05-20 | **DELETE 6 duplicate Purchase/IC/APInfo/AddToCart/Search legacy blocks** (Purchase Fire Thank-you, Purchase dedup lock, InitiateCheckout, AddPaymentInfo, Pixel AddToCart, Search Event). Cause: Meta showing 7 Purchase events while BQ orders 0 real orders today; thank-you page revisits + multiple Purchase blocks firing same order with different event_ids. After delete: 35 → 29 enabled |
| 2026-05-20 | **DELETE 4 paused legacy blocks** (PageView v1, SEID Bridge v1, Pixel ViewContent, ViewCategory). Already paused, 4 days no incident. 29 → 25... wait that's 31 actually since baseline was 35 |
| | (See git log for incremental changes) |
