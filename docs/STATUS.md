# ChromaFlask — Project Status

The living record of what is built, what is deliberately deferred, and what
comes next. Update this doc whenever a feature lands or a decision is made.

_Last updated: 2026-09-04_

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
- **Splash** — full-bleed entry art (`public/Entry.webp`) + live loading bar.
- **Home** — full-bleed scene art, avatar → profile card, coins/hearts pills,
  big play button, purple/gold bottom nav (Shop · Home · Levels).
- **Level map** — 200 nodes, stars per level, auto-scrolls to current level.
- **Gameplay** — candy-styled HUD, powerbar, coach + hand-pointer tutorial on
  level 1 (points at the solver's actual next move).
- **Win** — purple/gold dialog, staggered stars, "PERFECT!" on par runs, DOM
  confetti raining over the dialog.
- **More Lives dialog** — hearts state, live countdown, coin refill, shop link.
- **Profile card** — identity + lifetime stats (levels, stars, perfects, best
  streak, pours, hints), edit-look and settings entry points.
- **Stuck dialog** — undo / add bottle / restart (restart costs a heart); it
  re-opens if the player returns from the shop to a still-dead board.

### Economy & monetisation
- **Coins** — earned per win (base + stars + first-clear bonus).
- **Hearts** — 5 max, one regenerates per 30 min (wall-clock, works while the
  app is closed); lost on abandoning or failing a level (never during the
  tutorial); infinite-hearts boosts from bundles.
- **Powerups** — per-level free uses → shop-bought stock → **shop opens**
  (never silently charged to coins; empty badge becomes a green "+").
- **Shop** — 2 real-money bundles + 3 coin packs (via the Payments driver) and
  a coins section (heart refill, powerup 3-packs). "Popular"/"Best value"
  badges only — no fabricated discount claims (store policy).
- **Payments** (`src/services/Payments.ts`) — store-billing only, by design:
  Google Play Billing driver (Digital Goods API, localized prices, consumables
  consumed on grant); dev builds simulate the store behind an explicit
  confirm dialog; plain-web production hides real-money items entirely.

### Platform & polish
- Candy UI style throughout (gold trim, ivory pills, glossy green CTAs).
- Haptics on pours/errors/wins/buttons (Android; toggle in settings).
- Accessibility: colourblind glyphs, reduced motion, focus management, 44 px
  touch targets, safe-area insets.
- **Persistence** — save schema v4 with forward-compatible migrations
  (profile, level records, coins, inventory, lives, lifetime stats, mechanic
  intros). LocalStorage with in-memory fallback.
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
