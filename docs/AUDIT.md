# ChromaFlask — Full Product & Engineering Audit

_Audited 2026-09-05 against commit `7d2dab3` (main). Scope: game logic, economy,
UI/UX, security & compliance, performance, reliability, and market fit — read
with the assumption that the game will be onboarded by millions of players._

Everything in `src/`, `index.html`, `public/`, `scripts/`, `docs/` and the CI
workflow was read in full. `npm run typecheck`, `npm run lint` and
`npm run test:core` were run (all green, 3,672 checks). `npm run test:e2e` was
**not** run in this session (needs Edge + a display). Solver and generator costs
were benchmarked separately on this machine (Node 22, desktop).

> **Status (2026-09-05, same day):** all seven P0 items plus O2 are implemented
> and verified — `typecheck`, `lint`, `test:core` (3,681 checks) and
> `test:e2e` (both viewports, with new regression checks for the replay coin
> farm and the back button) are green. E1 (replays pay only for new stars),
> U3 (no stranding after a win with zero hearts; streak only breaks on a real
> heart loss), U1 (history-guard back button), E4 (grant → record → consume,
> restore on boot), S1 (sourcemaps off), S2 (consent toggle, docs corrected,
> privacy-policy draft in `PRIVACY-POLICY.md`), O1 (`client_error` telemetry),
> O2 (boot-failure Reload). Still yours to do for S2: host the policy and fill
> in the store data-safety forms. Not verified on a real Android device: the
> Play Billing restore path (needs a license tester in a TWA).
>
> **P1 progress (same day):** L1/P1 all 200 levels precomputed at build time,
> every par proven optimal (L192 tightened 23 → 22), solver moved to a Web
> Worker for hints and no-win proofs; P3 render loop pauses off the game
> screen; U4 splash follows real boot progress (450 ms floor); P2 critical
> images 712 → 547 KB; S3 build-time CSP (Pixi via `unsafe-eval` entry so
> `new Function` is not needed); O4 e2e runs on Playwright Chromium in CI
> (non-blocking until seen green); U2 mid-level resume (save v7, validated
> restore, "Continue level N", never re-asks for a heart; e2e-covered).
> P1 is complete except the lazy Pixi chunk, moved to P2: it saves ~140 KB gz
> on the critical path but requires making level start asynchronous, and the
> chunk already downloads in parallel via modulepreload.
>
> **Decisions taken with the owner's go-ahead (same day):** E2 economy
> rebalanced (200 start, free 3 undo / 1 hint / 0 bottle, 50 + 15/star);
> E6 hearts now pay only for failures (dead-ended or proven-unwinnable
> boards), never for quitting or restarting a live board; analytics consent
> is a visible, pre-checked choice on the first-run profile screen.

---

## Executive summary

The engineering foundation is unusually strong for a game at this stage: a pure,
engine-free rules core; every level machine-proven solvable with an optimal
par; deterministic boards; a real test suite gating every deploy; clean driver
seams for save/auth/analytics/payments; and genuine accessibility work. That is
rare and it is the right base to scale from.

It is **not yet ready for a large audience**. The blockers are not in the puzzle
engine — they are in the economy, a handful of player-flow bugs, on-device
performance of level generation, missing platform plumbing (Android back
button, purchase restore, crash reporting), and compliance documentation that no
longer matches what the build actually does.

### Scorecard

| Area | Grade | One line |
| --- | --- | --- |
| Puzzle logic & solver | **A** | Provably solvable, optimal par, audited by BFS. Best-in-class. |
| Level generation on device | **C** | 8 of 200 levels take 0.3–1.3 s on a fast desktop, synchronously on the main thread. Expect 2–8 s freezes on mid-range Android. |
| Difficulty curve | **B−** | Good rhythm to level 55; then 145 levels with only two knobs left. Free powerups flatten it entirely. |
| Economy & monetisation | **D** | Infinite coin farm via level replay; very generous starting economy; no rewarded ads; no purchase restore. |
| UI / UX | **B** | Polished, coherent, accessible. Missing Android back, mid-level resume, retention loop, and one stranded-player flow. |
| Security & integrity | **B** | Right threat model for single-player; sourcemaps leak the support secret; no CSP. |
| Privacy & compliance | **C** | PostHog analytics are live in production but the store docs still say "no data collected". |
| Performance | **B−** | ~200 KB gz JS/CSS is fine; ~710 KB of preloaded images and a never-pausing render loop are not. |
| Reliability & ops | **C+** | Excellent CI gate; zero crash reporting; no error telemetry at all. |
| Docs | **A** | STATUS / STORE-RELEASE / WRAP-ANDROID / support-codes are exemplary — keep them true. |

### The seven things to fix before any real traffic (P0)

1. **Coin farming** — replaying a cleared level pays 50–125 coins each time, with no heart cost. Level 1 takes ~10 s. (E1)
2. **Stranded after a win with zero hearts** — "Next level" → lives dialog → close leaves the player on a solved board; pressing back then threatens a heart and breaks their streak. (U3)
3. **Android back button exits the app** from every screen and modal. (U1)
4. **Purchases can be paid but never granted** — no restore of pending purchases on boot. (E4)
5. **Sourcemaps ship to production** — 2.7 MB, exposing the support-code HMAC secret in plain TypeScript. (S1)
6. **Privacy docs are wrong** — analytics are live; data-safety forms and the privacy policy must say so, and EU users likely need a consent toggle. (S2)
7. **No crash reporting** — at scale you are blind. (O1)

---

## 1. Game logic — the "brain"

### What is excellent

- **Rules engine** (`src/core/board.ts`): small, total, well-commented. `usefulMoves` pruning is correct and its cauldron exceptions are argued explicitly in code.
- **Solver** (`src/core/solver.ts`): A* over tube-order-canonicalised states with two admissible, consistent heuristics; the comment explaining why the cauldron bound must be `max`ed rather than summed is exactly the kind of proof-in-code that prevents regressions.
- **Generator** (`src/core/generator.ts`): deterministic per level id, cheap solvability gate before the exact solve, `isTooEasy` filter. Every level is verified solvable and byte-identical across regenerations in CI.
- **No-win detection**: a *proof* of unwinnability (space exhausted) drives the "no way to win from here" toast; inconclusive searches stay silent. This kills the single most common one-star review for sort games ("level X is impossible").
- **Cauldron** is a first-class rule set, not a hack: hashing, pruning, heuristics and UI all understand it.
- **Test suite** (`src/core/selftest.ts`): 3,672 checks including an independent BFS optimality audit under both rule sets and a round-trip of real support codes. This is a genuine quality gate.

### Findings

**L1 — HIGH — Level generation runs synchronously on the main thread and is slow for ~8 levels.**
Measured on this desktop (Node 22): 180 levels ≤ 50 ms, 12 levels 50–200 ms, and 8 levels over 200 ms — L192 1.29 s, L92 1.11 s, L172 0.86 s, L32 0.41 s, L72 0.37 s, L62 0.31 s, L124 0.29 s, L154 0.24 s. Mobile Chrome on a mid-range Android is typically 3–6× slower than desktop V8, so L92 and L192 will freeze the UI for several seconds at "Next level" with no feedback. `startLevel` calls `generateLevel` inline (`src/main.ts:744`).
*Fix (recommended, both halves):*
  - **Precompute** all 200 boards + solutions at build time into a JSON module (≈ 40–60 KB, ~15 KB gz). Generation is deterministic, so the output is identical to today's runtime result; the runtime cost drops to zero, and it lets you raise the exact-solve budget offline so every par is *truly* optimal (see L2). Keep the generator for endless mode and tests.
  - **Move the solver to a Web Worker** for anything still computed at runtime (hints, no-win proofs, endless levels). A worker also removes the 150 ms `setTimeout` compromise in `scheduleNoWinCheck`.

**L2 — MEDIUM — "Par is genuinely optimal" is not always true.**
Cauldron levels fall back to a weight-1.25 search when the exact solve exceeds 60 k nodes (`generator.ts:65-67`), and the `optimal` flag on `SolveResult` is never surfaced or asserted for the campaign. The star tolerance (par + max(2, 15 %)) absorbs it in practice, but the README claim is stronger than the code. Precomputing (L1) removes the budget constraint; then assert `optimal === true` for all 200 levels in `test:core`.

**L3 — MEDIUM — Free powerups nullify the difficulty curve.**
Every attempt grants 3 free undos, 3 hints and 3 bottles (`DEFAULT_ECONOMY.freeUses`), and the bottle powerup can add 2 tubes. A 1-empty "squeeze" level becomes a 3-empty breather for free; a hint returns the optimal move, so 3 stars are trivially achievable on any level with 3 hints. The curve you tuned so carefully is optional. Market norm: 0–1 free hint per level, bottle behind coins or a rewarded ad. See E2.

**L4 — LOW — The curve runs out of knobs after level 55.**
Colours cap at the palette's 8 from level 56 to 200; the remaining dials are minPar (+4 total) and murky cadence. Players who reach L100 face 100 near-identical boards. Options, each a contained change to `levels.ts` + a rule flag: 5-unit tubes on some bands; a 9th–12th colour (glyph set already has room for more shapes); a **locked tube** (opens after N pours); a **one-way tube** (pour in only). Introduce one new idea every ~30 levels, exactly the way the cauldron and murk were introduced.

**L5 — LOW — Endless mode is free content you are not shipping.**
`specFor(id)` and the seeded generator already work for any id. "All levels cleared. More coming soon." should be an endless mode (`id > 200` with a rotating spec), with the generation done in a worker (L1).

**L6 — LOW — Analytics semantics.** `attempt` is a global session counter, not per-level (`main.ts:737`); `level_quit` also fires on the win modal's "Home" button (`quitToHome`), polluting the quit funnel. Track `attempt` per level id and emit `level_exit` with a `reason` instead.

---

## 2. Economy & monetisation

**E1 — CRITICAL — Infinite coin farm through replays.**
`onWin` pays `coinsFor(stars, isFirstClear)` on every win: 50 base + 25/star even for a level already cleared (`main.ts:1010-1012`). Winning costs no heart. Level 1 has par 4 and takes ~10 s including animations, paying 125 coins per replay: the 500-coin heart refill in ~40 s and the equivalent of the $19.99 "Chest of coins" (12,000) in about 16 minutes. Any player who notices this never buys anything.
*Fix:* replays pay 0, or only the *improvement* (new stars × 25), or a small flat replay bounty (5–10) capped per day.

**E2 — HIGH — The economy is too generous to create purchase intent.**
1,000 starting coins, 175 coins per first clear, 3 free of each powerup per attempt, hint 3-pack at 200 coins. A player will end the 200-level campaign with thousands of coins and nothing to spend them on. Benchmarks in the category: 0–100 starting coins, 1 free hint total per level (often ad-gated), bottles never free.
*Suggested baseline:* start 200 coins; free uses `{undo: 1, hint: 1, bottle: 0}` (undo could stay unlimited — undo generosity reduces frustration, hints/bottles are the monetisable ones); first-clear 50 + 15/star; make `RemoteConfig` actually fetch so this can be A/B tuned without a store update (the seam exists).

**E3 — HIGH — No rewarded video.**
For casual puzzle at scale, rewarded ads are typically the majority of revenue and the main free-to-play "currency" (watch for a hint / a bottle / a heart / 2× coins). `STORE-RELEASE.md` declares no ads today — that is a legitimate choice, but it means hearts + IAP-only, which is the friction model of Candy Crush without its scale. If you keep no-ads, remove hearts (see E6). If you add ads, put them behind an `AdsService` driver exactly like `Payments`, and re-do the data-safety forms.

**E4 — HIGH — Purchases can be paid for and never granted.**
`PlayBillingDriver.purchase` completes the payment sheet and grants in the same call. If the app is killed or crashes between the Play sheet closing and `save.addCoins`, the player has paid, nothing is granted, and because the token was never consumed the SKU cannot be bought again. There is no `listPurchases()` on boot (`Payments.ts` has no restore path).
*Fix:* on `init`, call `service.listPurchases()`, grant every unconsumed token idempotently (persist granted tokens in the save), then `consume`. Reorder the live purchase to: grant → persist token → consume → `complete('success')`. Do the same in the future StoreKit driver.

**E5 — MEDIUM — Receipt validation (known).** Client-side grants are spoofable. Before revenue matters, a tiny verification endpoint is needed. Note for the roadmap: because boards are deterministic, a server can **verify any claimed solve by replaying the move list** — cheap, exact anti-cheat for a future leaderboard without trusting the client.

**E6 — MEDIUM — Heart rules are harsh and inconsistent.**
A heart is lost on *quit* (not just failure), and on "Restart" from the stuck dialog — but the top-bar restart button is free, and the "no way to win" toast leaves that free restart available. Top water-sort games generally have **no lives at all**. Pick one: (a) no hearts, gate with ads/coins; or (b) hearts lost only on failure/dead-end restart, never on quit, and make all restart paths consistent.

**E7 — LOW — Deterministic `Date.now()` heart regeneration** is trivially bypassed by changing the device clock. Accepted for now; note it for the server milestone.

---

## 3. UI / UX

### What is excellent

- Coherent "candy" visual language, HUD in DOM for crisp text, Pixi only for the board.
- Tutorial advances on real actions and the hand points at the solver's actual next move.
- Tapping a non-target that could be a source switches selection instead of buzzing — small, and exactly right.
- Pour choreography: level liquid surface under tilt, parabolic stream, per-amount audio pitch, input reopens before the return arc.
- Accessibility: colour-blind glyphs, reduced-motion toggle + media query, 44 px hit areas, `role=dialog`/`aria-modal`, focus moved into dialogs, `aria-live` toasts, safe-area insets, keyboard on desktop.

### Findings

**U1 — HIGH — Android back button exits the app.**
There is no `history.pushState`/`popstate` handling anywhere. In a TWA, hardware/gesture back on the game screen, shop, or a modal closes the whole app. Push a history entry per screen and per modal; on `popstate` close the modal or return to home; on home, let it exit. This also gives web players a working browser back.

**U2 — HIGH — No mid-level resume.**
Closing the app mid-level discards the board and move history (`SaveData` has no in-progress state). Casual players background games constantly. Persist `{levelId, board, history, hidden, extraTubes, uses, startedAt}` on every move (the save already coalesces writes) and offer "Continue level 47?" on launch.

**U3 — HIGH — Stranded after a win with zero hearts.**
Flow: win → "Next level" → `startLevel` sees `!canPlay` → lives dialog opens over the *solved* previous board → player closes it → they are on a completed level with a live back button. Back then shows "You will also lose a heart" (for a level already won) and `loseLife('quit')` calls `breakStreak()` unconditionally — so **the win streak is broken by winning**. Restarting that board also re-awards coins (E1).
*Fix:* when the lives dialog closes without a retry and the current board is resolved, go home; make `breakStreak` conditional on an actual heart loss; treat back on a resolved board as plain navigation.

**U4 — MEDIUM — Every launch costs 1.6 s of splash** regardless of actual boot time (`animateSplash` is a fixed-duration animation that boot awaits). Returning players should be on home in well under a second. Drive the bar by real progress (stage init, image decode) with a short minimum (~500 ms) so it never flashes.

**U5 — MEDIUM — No retention loop.** The only reason to come back is the heart timer. Missing, all feasible without a server because boards are deterministic:
  - **Daily challenge**: `seed = YYYYMMDD`, one board per day, streak calendar.
  - **Daily login reward** and a 7-day chest track.
  - **Achievements** (perfect clears, streaks, no-hint clears) — the stats already exist in `LifetimeStats`.
  - **Heart-refill / daily notification** via the native wrapper.

**U6 — MEDIUM — The level map is a flat 200-node grid.** Competitors organise into themed chapters (every 20–25 levels) with a chapter-complete celebration and a visual change of scenery. Your level names, the palette and the mechanic cadence already give you natural chapter boundaries; this is mostly presentation.

**U7 — MEDIUM — Music starts automatically on the first tap anywhere** (`audio.unlock` → `startMusic`). Common, but a frequent source of mutes and one-star reviews. Consider fading in only after the tutorial's first pour, or defaulting music off on web (keep on in the installed app).

**U8 — MEDIUM — Twist mechanics are introduced by a toast only.** A 4-second toast at the moment a new vessel appears is easy to miss on the first cauldron (L22) and first murky level (L36). Reuse the `Tutorial` machinery for a two-step guided intro on those levels.

**U9 — LOW — Accessibility gaps.** Modals have no focus trap (Tab escapes to the background). `user-scalable=no, maximum-scale=1` violates WCAG 1.4.4 (common in games, but consider allowing zoom on DOM-only screens). No text alternatives for colour on the shop badges.

**U10 — LOW — Localisation.** Every string is hard-coded English across `main.ts`, `index.html`, `Tutorial.ts`. For a global audience, introduce a string table now while the surface is ~120 strings; retrofitting later is far more expensive. Number formatting already uses `toLocaleString` in places — make it consistent.

**U11 — LOW — Toasts have no queue or cap;** the cauldron intro, a no-win warning and a "Stuck? Try a hint" nudge can stack on top of each other on the same board.

**U12 — LOW — Win screen** has no "replay for stars" affordance, no chapter context, no share. Fine for now; note for the chapter work.

---

## 4. Security, integrity & compliance

Threat model today: no backend, the client owns all state, the player can only cheat themselves. That is the right model for single-player — and it stops being adequate the moment anything competitive or paid depends on client state (E5). Findings within the current model:

**S1 — HIGH — Production sourcemaps.** `vite.config.ts` sets `sourcemap: true`; `dist/assets/*.map` total 2.7 MB and reconstruct every source file verbatim, including `Support.ts` and its HMAC secret. Forging a self-targeted "coins 65535" or "level 200" code goes from "reverse a minified bundle" to "read a file". Set `sourcemap: false` (or `'hidden'` and upload maps only to your error tracker). Also a bandwidth and cache win.

**S2 — MEDIUM — Privacy/compliance drift.** `Analytics.ts` ships a live PostHog token and `main.ts:98` sends every event with the save's `supportId` as `distinct_id`. `STORE-RELEASE.md` §3 still says "no data collected, analytics are local/console today" and the README says analytics "logs to the console in dev". For Google Play's Data Safety form and Apple's nutrition label this is *App interactions* + *Device or other IDs*, collected, not shared, not linked to identity. For EU/UK users a pseudonymous ID for analytics generally needs a lawful basis and a disclosure; a settings toggle ("Share anonymous usage data", default on outside the EU, off/asked inside) is the low-friction answer. Update the two docs, write the privacy policy, and restrict the PostHog project to your domains.

**S3 — MEDIUM — No Content Security Policy.** GitHub Pages cannot set headers, but a `<meta http-equiv="Content-Security-Policy">` works: `default-src 'self'; script-src 'self'; connect-src 'self' https://us.i.posthog.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:`. This turns any future injected script into a no-op and is cheap insurance for a game that will handle payments.

**S4 — MEDIUM — Supply chain hygiene.** Only two runtime dependencies (good), lockfile committed, `npm ci` in CI (good). Add `npm audit --omit=dev` to the workflow and enable Dependabot. Pin the GitHub Actions to SHAs.

**S5 — LOW — Save validation.** `migrate` trusts shapes (`parsed.levels ?? {}`); a hand-edited or corrupted record with a non-numeric `stars` propagates `NaN` into `totalStars` and the home screen. Validate numerically on load and drop bad entries.

**S6 — LOW — Payment ordering.** `response.complete('success')` runs before the grant and before `consume`; a throw after completion loses the purchase (see E4 for the full fix).

**S7 — INFO — XSS surface reviewed and clean.** The only untrusted string is the profile name; it is escaped where `innerHTML` is used and set via `textContent` elsewhere. `bodyHtml` is app-authored only. Support code input is fully validated before use.

**S8 — INFO — Support codes** (48-bit truncated HMAC, device-bound, single-use, 14-day expiry) are proportionate. The documented trade-off (secret in the client) is correct — as long as S1 is fixed and codes never gate anything competitive.

**S9 — INFO — Clock tampering** regenerates hearts. Accepted; server time later.

---

## 5. Performance & speed

### Measured

| Asset | Raw | Gzip |
| --- | --- | --- |
| pixi chunk | 491 KB | 138 KB |
| gsap chunk | 70 KB | 27 KB |
| app chunk | 85 KB | 28 KB |
| CSS | 29 KB | 7 KB |
| **JS+CSS total** | **675 KB** | **~200 KB** |
| Entry.webp (preload, high) | 230 KB | — |
| logo.webp (preload, high) | 299 KB | — |
| home.webp (preload) | 183 KB | — |
| **Images on the critical path** | **712 KB** | — |

Level generation: see L1. Hint and no-win checks from live, solvable positions: < 1 ms even on the hardest levels (the weighted search finds a line immediately). The expensive solver case is only the *proof of unwinnability*, which is budget-capped.

### Findings

**P1 — HIGH — Main-thread level generation** (= L1). Precompute + worker.

**P2 — MEDIUM — ~0.9 MB before the first interactive frame**, most of it images preloaded at high priority. `logo.webp` is 299 KB for a slot that is at most 360 CSS px wide — re-encode at quality ~75 (≈ 70–90 KB) or ship AVIF with WebP fallback; Entry can drop to ~120 KB. Defer `home.webp` until the splash is showing. Also consider lazy-loading the Pixi chunk until the game screen — splash, profile, home, map and shop are pure DOM, so 138 KB gz leaves the critical path.

**P3 — MEDIUM — The render loop never pauses off the game screen.** `GameStage.setPaused` is only called on `visibilitychange`. On home, map and shop the canvas is `display:none` but the ticker still runs starfield, particles and every bottle's `update` each frame — pure battery and thermal cost, and it makes the "modal pauses rendering" comment in `GameStage.ts:99` untrue. Pause when `current !== 'game'` and while a modal is open.

**P4 — LOW — Per-frame Graphics rebuilds.** `Starfield` and `ParticleField` clear and rebuild a `Graphics` every frame. Fine at 90 stars / 420 particles, but on low-end GPUs a sprite-based starfield (or a static texture with a slow scroll) is cheaper. Measure before changing.

**P5 — LOW — `antialias: true` with resolution 2.** MSAA on a 2× buffer is the most expensive default Pixi offers on phones. At dpr ≥ 2 the glass edges are already smooth; consider `antialias: dpr < 2` and profile on a Pixel 4a / Galaxy A14 class device before store submission (your own checklist asks for this).

**P6 — LOW — `backdrop-filter: blur(7px)` on the modal backdrop** is a full-screen blur on every dialog open; on low-end Android it is a visible hitch. Fall back to a solid `rgba` under reduced-motion, or drop the blur.

**P7 — LOW — Service worker cache grows forever.** `VERSION` is constant and `activate` only deletes *other* cache names, so each deploy's hashed assets accumulate. Inject the build hash into `sw.js` at build time, or prune on activate to `PRECACHE ∪ assets referenced by the current index`.

**P8 — INFO — Good choices worth keeping:** transparent canvas over a CSS gradient; delta clamp on resume; dirty-flag liquid redraws; coalesced save writes; flush on `pagehide`; manual chunking; `modulepreload`.

---

## 6. Reliability, observability & operations

**O1 — HIGH — No error telemetry.** No `window.onerror`, no `unhandledrejection` handler, no exception capture. With millions of sessions you will have WebGL context losses, `localStorage` quota errors, Pixi init failures on odd GPUs, and unknown-unknowns, and you will hear about them only in reviews. Add global handlers that send `renderer`, `level`, `saveVersion`, `supportId` and a stack to PostHog (exception capture) or Sentry, and show a friendly recovery UI.

**O2 — MEDIUM — WebGL context loss and Pixi init failure are unhandled.** `stage.init` rejects → `boot` rejects → the splash sits at 100 % forever. Catch and offer "Reload" / fall back to a canvas renderer.

**O3 — MEDIUM — Analytics loses offline events.** Each event is a fire-and-forget `fetch`. Queue to `localStorage` and flush on reconnect; batch with PostHog's `/batch/` endpoint.

**O4 — MEDIUM — E2E does not run in CI.** `smoke.mjs` hard-codes Edge on Windows. Switch to Playwright's bundled Chromium (`npx playwright install chromium`) so the flow test guards every deploy, not just your machine. Also consider a PR-preview deploy rather than deploying every push to `main` straight to production.

**O5 — LOW — Two tabs / two windows** with the same save: last write wins, silently. Listen for the `storage` event and reload the save or warn.

**O6 — LOW — Show the build version** (git SHA injected at build) in Settings; it is the first thing support needs.

**O7 — LOW — `await remote.refresh()` gates boot.** Fine while static; the day a fetch driver lands it must have a timeout and stale-while-revalidate.

---

## 7. How this compares to the market

| Capability | ChromaFlask | Category leaders (Water Sort Puzzle, Sort Water Color, etc.) |
| --- | --- | --- |
| Puzzle correctness | Proven solvable, optimal par | Mostly hand/random, "impossible level" complaints common |
| Level count | 200 (endless is one flag away) | 1,000s + endless |
| Lives / hearts | 5 hearts, 30 min regen, lost on quit | Usually **none** |
| Monetisation | IAP only | Interstitial + rewarded ads + IAP, often "remove ads" IAP |
| Daily content | None | Daily challenge, login rewards, events |
| Meta / collection | Deferred | Themes, bottle skins, backgrounds |
| Social | None | Leaderboards, sometimes friends |
| Cloud save | None | Common (Play Games / Game Center) |
| Localisation | English only | 20+ languages |
| Accessibility | Colour-blind glyphs, reduced motion | Usually none — a real differentiator for you |

The differentiators you already have (correctness, no-win proof, accessibility, no third-party assets, original mechanics) are exactly the things the category is bad at. The gaps are all "operate at scale" items rather than "make the game good" items.

---

## 8. Prioritised roadmap

**P0 — before any real traffic (days)**
E1 replay coin farm · U3 stranded-after-win flow · U1 Android back · E4 purchase restore + grant ordering · S1 sourcemaps off · S2 privacy docs + consent toggle · O1 error telemetry · O2 boot failure UI.

**P1 — first weeks (structural)**
L1/P1 precompute levels + solver worker · U2 mid-level resume · P3 pause render loop off-game · P2 image re-encode + lazy Pixi · E2 economy rebalance behind a live `RemoteConfig` · E6 one consistent heart rule (or none) · S3 CSP · O4 e2e in CI · U4 real splash progress.

**P2 — growth (weeks to months)**
L5 endless mode · U5 daily challenge + login rewards + achievements · U6 chapters · L4 new mechanic every ~30 levels · U10 i18n · E3 ads driver (if chosen) · leaderboard via Play Games / Game Center with **replay-verified** submissions (E5) · cloud save via the same platform services.

---

## Appendix — what was verified in this session

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run test:core` — 3,672 checks passed; 200 levels generated in 8.1 s total; worst L192 at 1,368 ms.
- Separate benchmark: generation distribution (180 ≤ 50 ms / 12 in 50–200 ms / 8 > 200 ms); `findHint` and `solvability(30k)` from mid-solution positions on the 12 hardest levels: all < 1 ms.
- `dist/` inspected: chunk sizes (raw + gzip), sourcemaps present, CSS asset URLs correctly rewritten to relative paths, preload order.
- Git: only two secrets-like values in history — the public PostHog client token and the support HMAC secret (both by design, see S1/S2).
- Not run: `npm run test:e2e` (requires Edge and a display).
