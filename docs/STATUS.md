# ChromaFlask — Project Status

The living record of what is built, what is deliberately deferred, and what
comes next. Update this doc whenever a feature lands or a decision is made.

_Last updated: 2026-09-05_

---

## ✅ Shipped & verified

### Core game
- **Rules engine** (`src/core/board.ts`) — pours, win/deadlock detection,
  canonical state hashing, all behind a `BoardRules` abstraction.
- **Solver** (`src/core/solver.ts`) — A* with admissible heuristics; pars are
  provably optimal and audited against an independent brute-force BFS in CI.
- **Generator** (`src/core/generator.ts`) — deterministic per level id (every
  player gets the identical board), every level machine-proven solvable before
  it is accepted, with its winning line attached (powers hints + tutorial).
- **Precomputed campaign** (`src/core/campaign.json`, built by
  `npm run levels:build`) — all 200 boards and winning lines computed once at
  build time (52 KB, ~11 KB gzipped), so "Next level" costs zero solver work
  on-device (the worst seeds took 1.3 s on a desktop and several seconds on a
  phone). With no time budget the exact solve runs to completion: **every
  stored par is proven optimal** (one par tightened vs. the runtime
  generator, L192 23 → 22). `getCampaignLevel` validates each stored line by
  replay and falls back to the generator if anything is off. `test:core`
  proves the file against the live generator on every run.
- **Solver worker** (`src/core/solver.worker.ts`, `services/SolverClient.ts`)
  — hints and the no-win proof run off the main thread; exhausting the
  proof budget on a cauldron board is ~0.5 s of CPU on a desktop. Results are
  discarded if the board moved on; a dead worker degrades to synchronous
  search. No-win coverage extended from 8 to 10 tubes.

### 200-level campaign (`src/core/levels.ts`)
- Hand-tuned opening (1–10), then a measured sawtooth curve: colour bands
  6 → 7 → 8, par floors 13 → 21, **breather** every 10th level (extra tube),
  **squeeze** every 10th (one empty tube).
- Verified end-to-end by `npm run test:core` (~3,700 checks): solvable, par =
  solution length, minPar met, unit conservation, byte-identical determinism,
  generation speed (worst ≈ 1 s desktop for one deep cauldron seed; typical
  well under 100 ms).

### Twist mechanics
- **The Cauldron** (from level 22, every 10th) — gold-rimmed pot at tube 0:
  accepts **any** colour, but **must be empty to win**. First-class solver
  rules (extra admissible heuristic bound, position-sensitive hashing, pruning
  proven safe by the BFS optimality audit). Never "locks in"; hint/undo/stuck
  flows all understand it.
- **Murky potions** (from level 36, ramping to dominant past 120) — colours
  below each tube's mouth start concealed ("?" murk) and reveal permanently as
  they surface. Purely visual; solver and par untouched.
- Both introduced by one-time toasts, staggered so players meet one idea at a
  time; both documented in "How to play".

### Screens & flow
- **Splash** — full-bleed entry art (`public/Entry.webp`) + loading bar
  driven by real boot milestones (config, save, renderer, wiring) with a
  450 ms floor so it never flashes; a returning player on a fast device is on
  the home screen in well under a second.
- **Home** — full-bleed scene art, avatar → profile card, coins/hearts pills,
  big play button, purple/gold bottom nav (Shop · Home · Levels).
- **Level map** — 200 nodes, stars per level, auto-scrolls to current level.
- **Gameplay** — candy-styled HUD, powerbar, coach + hand-pointer tutorial on
  level 1 (points at the solver's actual next move).
- **No-win detection** — after each move on small boards, the solver *proves*
  whether a winning line still exists; if not, a one-time toast says "No way
  to win from here - use Undo or Restart" (silent when inconclusive, re-armed
  by undo/new bottle). Kills the "this level is impossible" misread.
- **Gentle onboarding** — levels 1-10 are all two-empty boards; single-empty
  squeeze boards start at level 18, after the player has the skills.
- **Win** — purple/gold dialog, staggered stars, "PERFECT!" on par runs, DOM
  confetti raining over the dialog.
- **More Lives dialog** — hearts state, live countdown, coin refill, shop link.
- **Profile card** — identity + lifetime stats (levels, stars, perfects, best
  streak, pours, hints), edit-look and settings entry points.
- **Stuck dialog** — undo / add bottle / restart (restart costs a heart); it
  re-opens if the player returns from the shop to a still-dead board.

### Economy & monetisation
- **Coins** — earned per win (base + stars + first-clear bonus). Replays pay
  only for stars not previously earned, so a cleared level is never a coin
  farm (`coinsFor`, covered by `test:core` and `test:e2e`).
- **Hearts** — 5 max, one regenerates per 30 min (wall-clock, works while the
  app is closed). One rule: a heart pays for a **failure** — restarting or
  leaving a board that is dead-ended or proven unwinnable. Quitting or
  restarting a live board is free, the tutorial never costs a heart, and
  infinite-hearts boosts come from bundles.
- **Powerups** — per-attempt free uses (3 undo, 1 hint, 0 bottle) →
  shop-bought stock → **shop opens** (never silently charged to coins; empty
  badge becomes a green "+"). Bottles are deliberately never free: a free
  extra tube erases the difficulty curve.
- **Economy tuning** — 200 starting coins; a 3-star first clear pays 95
  (50 + 15/star). Hint ×3 = 200, Bottle ×3 = 320, Undo ×3 = 80, hearts 500.
  All in `DEFAULT_ECONOMY`, meant to be retuned live via RemoteConfig.
- **Shop** — 2 real-money bundles + 3 coin packs (via the Payments driver) and
  a coins section (heart refill, powerup 3-packs). "Popular"/"Best value"
  badges only — no fabricated discount claims (store policy).
- **Payments** (`src/services/Payments.ts`) — store-billing only, by design:
  Google Play Billing driver (Digital Goods API, localized prices); dev builds
  simulate the store behind an explicit confirm dialog; plain-web production
  hides real-money items entirely. Delivery is grant → record token → consume,
  and every boot restores purchases the store still holds as unconsumed, so
  an app killed mid-purchase never loses the sale or double-grants it.

### Platform & polish
- Candy UI style throughout (gold trim, ivory pills, glossy green CTAs).
- Haptics on pours/errors/wins/buttons (Android; toggle in settings).
- Accessibility: colourblind glyphs, reduced motion, focus management, 44 px
  touch targets, safe-area insets.
- **Persistence** — save schema v7 with forward-compatible migrations
  (profile, level records, coins, inventory, lives, lifetime stats, mechanic
  intros, support ID, redeemed codes, granted purchase tokens, in-progress
  attempt). LocalStorage with in-memory fallback.
- **Mid-level resume** — the current attempt (board, moves, murk state, extra
  tubes, powerup uses, play time) is saved after every move; killing the app
  mid-level costs nothing. Home offers "Continue level N", the map node for
  that level resumes too, and a resumed level never re-asks for a heart. The
  saved position is validated against the level (same colour units, capacity,
  tube count) before it is trusted. Cleared by a win, restart or confirmed
  quit; the tutorial level is never resumed mid-way.
- **Back button** — one history "guard" entry exists while there is anything
  to go back from. Android/browser back closes a dismissable dialog, asks to
  leave a level, closes the shop, or returns from the map; on home with
  nothing open it exits, as Android expects.
- **Error reporting** — uncaught errors and rejections (and boot failures) are
  sent as `client_error` analytics events, de-duplicated and capped at five
  per session. A failed boot shows a Reload control instead of a stuck splash.
- **Analytics consent** — Settings → "Share anonymous usage data" (default on)
  gates every event that leaves the device.
- **Content Security Policy** — injected as a `<meta>` tag at build time
  (`vite.config.ts`): scripts only from the bundle, connections only to
  PostHog, no eval. Pixi is loaded through `pixi.js/unsafe-eval` so its
  shader uniform sync works without `new Function`.
- **Render loop pauses off the game screen** — home, map and shop no longer
  draw starfield and bottles into a hidden canvas every frame.
- **Art budget** — `optimize-art.mjs` carries per-image quality/width
  settings; critical-path images went from 712 KB to 547 KB; home art
  preloads at low priority.
- **E2E in CI** — `smoke.mjs` uses Edge when present, otherwise Playwright's
  Chromium; the deploy workflow runs it non-blocking until it has been seen
  green on the runner (then drop `continue-on-error`).
- **Art pipeline** — drop PNG sources in `art/`, run
  `node scripts/optimize-art.mjs` → optimized WebP in `public/` (preloaded).
- **PWA / store-wrap readiness** — full icon set (192/512 + maskable variants
  + apple-touch-icon, generated from `art/icon*.svg` via
  `node scripts/make-icons.mjs`), complete web manifest, and an offline
  service worker (`public/sw.js`: network-first navigations, cache-first
  hashed assets; registered in production builds only). Android wrap guide:
  [WRAP-ANDROID.md](WRAP-ANDROID.md).
- **Tests** — `test:core` (rules/solver/generator, no browser) and `test:e2e`
  (drives the real game in Edge: full flows, economy assertions, tutorial,
  persistence across reload).

---

## ⚠️ Known issues / follow-ups

| Item | Detail |
| --- | --- |
| Entry art misspelled | `art/Entry.png` bakes in "CHROME FLASK" (wrong name, and "Chrome" is a Google mark). Regenerate — ideally with **no text** so a code logotype can be overlaid. |
| Trademark search | Run "ChromaFlask" through USPTO/EUIPO + both app stores before launch. |
| iOS haptics | Web vibration is unsupported on iOS; the Capacitor wrapper needs a native haptics bridge. |
| Receipt validation | Client-side purchase grants are fine for launch but spoofable; add a server verification endpoint before revenue scales. |
| Full audit | [AUDIT.md](AUDIT.md) (2026-09-05) — findings by area with a P0/P1/P2 roadmap. P0 complete. P1: L1/P1 precompute + worker, P3, P2 images, S3 CSP, O4, U4 done; U2 mid-level resume and lazy Pixi next. |

---

## 🚫 Deferred — deliberate decisions, with reasons

| Feature | Why deferred | Unblocks when |
| --- | --- | --- |
| **Wildcard / rainbow drop** | "Matches any colour" semantics ripple through run-counting, uniformity and state hashing; risks silently breaking par optimality. Needs its own verified pass. | Next mechanic slot |
| **Leaderboard** | Never a custom server for v1 — use Google Play Games Services / Apple Game Center (free, identity handled, store-compliant). | After native wrap |
| **Teams** | Requires a real backend plus UGC obligations (moderation, reporting, blocking) and ongoing costs. Retention feature for a game that already has players. | Traction |
| **Collection** | Fully feasible client-side, but it's a long-tail retention feature; needs content depth to hang on. | After launch |
| **Container skins** (mug, teacup…) | Agreed: no theme pivot — potion/alchemy identity stays. Skins return later as unlockables/cosmetics. | With Collection |

---

## 🗺️ Next milestones (in order)

1. **Store wrap — your accounts** (code side is ready, see
   [WRAP-ANDROID.md](WRAP-ANDROID.md)): deploy `dist/` to the final HTTPS
   domain, Play Console + merchant profile, Bubblewrap init/build, asset
   links, create the 5 SKUs from `IAP_CATALOG`. iOS afterwards via Capacitor
   + a `StoreKitDriver` implementing `PaymentDriver`.
2. **Store listing & compliance** — privacy policy URL, data-safety forms,
   content rating, screenshots. Checklist: [STORE-RELEASE.md](STORE-RELEASE.md).
3. **Wildcard drop mechanic** — same rigor as the Cauldron (rules, heuristic
   proof, BFS audit).
4. **Leaderboard** (platform services) → **Collection** → **Teams** (traction-gated).

---

## Definition of done for any change

`npm run typecheck && npm run lint && npm run test:core && npm run build` —
plus `npm run test:e2e` when flows change. Level/curve changes must keep
`test:core` green: that suite *is* the proof the campaign is correct.
