# ChromaFlask — Project Status

The living record of what is built, what is deliberately deferred, and what
comes next. Update this doc whenever a feature lands or a decision is made.

_Last updated: 2026-09-06_

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
  `npm run levels:build`) — all 500 boards and winning lines computed once at
  build time (132 KB, ~28 KB gzipped), so "Next level" costs zero solver work
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

### 500-level campaign (`src/core/levels.ts`)
- Hand-tuned opening (1–10), then a measured sawtooth curve: colour bands
  6 → 7 → 8, par floors 13 → 21, **breather** every 10th level (extra tube),
  **squeeze** every 10th (one empty tube).
- The par floor climbs through the whole distribution of deals instead of
  sitting under it: full eight-colour boards 17 → 19 (56–100), 20 → 21
  (101–150), 22 (151–200), then 23 → 27 across five tiers of sixty
  (201–500); squeezes 14 → 19, cauldrons 15 → 18, breathers 13 → 17. From the
  third tier a second squeeze joins each block of ten and murk rises to three
  levels in four. Measured on the precomputed file: the full-board ideal
  rises monotonically 17 → 21 → 24.5 → 24.9 → 25.5 → 25.9 → 26.4 → 27.4 across
  the blocks from 11–30 to 441–500; the all-levels block average goes 11.5 →
  24.4 and is diluted by squeezes (~17–19) and cauldrons (~18–19), which sit
  lower by design as the rhythm beats. All 500 pars proven optimal offline; the
  precompute pays for the rejected deals, players never wait. These tiers are
  also where the next mechanics land (AUDIT.md L4).
- Verified end-to-end by `npm run test:core` (~3,700 checks): solvable, par =
  solution length, minPar met, unit conservation, byte-identical determinism,
  generation speed (worst ≈ 1 s desktop for one deep cauldron seed; typical
  well under 100 ms).

### Endless mode (levels 201+)
- Numbered straight on from the campaign and generated on demand in the
  solver worker (`endlessSpec` in `levels.ts`; "Brewing a fresh potion…" if
  it takes more than 300 ms). A five-level cycle of proven shapes - 8-colour
  board, 7-colour murky, cauldron squeeze, plain squeeze, breather - with the
  par floor rising one step every 20 levels up to each shape's campaign cap,
  and murk alternating. Deterministic per id, so resume and analytics work
  unchanged.
- Entered from the level-500 win screen ("Start endless mode"), the home Play
  button once the campaign is done ("Endless #n"), or a gold ∞ node at the
  foot of the map. HUD and win screen say "Endless #n"; profile shows
  "Endless cleared". Campaign counters (stars, cleared, progress bar) count
  campaign ids only.
- `test:core` generates a ten-level sample at both ends of the ramp (worst
  ~0.8 s desktop); `test:e2e` starts Endless #1 through the worker.

### Daily challenge
- One board per **local** calendar day, seeded from the date
  (`src/core/daily.ts`: id = 1,000,000 + day number, far above campaign and
  endless ids), generated in the worker. Five shapes rotate at mid-campaign
  depth so any player finds it a fair single sitting; murk alternates.
- Home has a Daily challenge button under Play whose second line reads the
  state: "A new potion every day" / "🔥 3-day streak · play today to keep it"
  / "Done today ★★☆ · 🔥 3-day streak".
- First clear of the day pays the normal reward plus `dailyBonus` (50) and
  advances the streak; replaying the same day pays nothing new. The streak
  extends only from yesterday, lapses after a missed day, and is unit-tested
  (`advanceStreak`, `currentStreak`). Records live in their own save section
  (v9), capped at 120 days; campaign counters are untouched.
- Win screen: date as the eyebrow, "🔥 n-day streak" pill, Home as the
  primary action. Profile shows current and best daily streak.
- **Share** (daily win screen only) — a few lines of plain text the way word
  games are shared: "🧪 ChromaFlask Daily · date", "★★★ 21 moves · ideal 21 ·
  Perfect!", the streak when above one, and the game link. Native share sheet
  where the browser has one, else clipboard with a toast, else a dialog with
  the text selected. Sharing leaves the win screen open; a dismissed sheet is
  silent. `daily_share` analytics event (method share/copy). The smoke test
  wins today's daily and checks the built text through the dev hook.
- Verified: core suite deals a week of dailies and round-trips day arithmetic
  across a DST boundary; smoke test starts today's daily through the worker.

### Achievements & login reward
- **Achievements** (`src/core/achievements.ts`) — 17 milestones over the
  lifetime stats (first clear, perfect clears, chapters, stars, win streaks,
  daily streaks, pours, endless). Evaluated after every win; each pays a
  small coin reward once, ever, with a staggered "🏅 Name · +N coins" toast.
  Profile card shows the count and opens the list (earned vs locked).
- **Login reward** — first arrival at home each local day opens a "Daily
  reward" dialog: a seven-tile track (20/30/40/50/60/80/150 coins, day 7 also
  refills hearts), today highlighted, one Claim button. Consecutive days
  advance the track; a missed day restarts it; after day 7 it repeats. Once
  per day, never over another dialog. Tuning in `LOGIN_REWARDS`.
- Save v11 (`achievements`, `login`). Core suite checks the cycle math and
  that a fresh view earns nothing while a maxed view earns everything; the
  smoke test claims the day-1 reward and separates achievement coins from the
  win reward in its economy sums.

### Twist mechanics
- **The Cauldron** (from level 22, every 10th) — gold-rimmed pot at tube 0:
  accepts **any** colour, but **must be empty to win**. First-class solver
  rules (extra admissible heuristic bound, position-sensitive hashing, pruning
  proven safe by the BFS optimality audit). Never "locks in"; hint/undo/stuck
  flows all understand it.
- **Murky potions** (from level 36, ramping to dominant past 120) — colours
  below each tube's mouth start concealed ("?" murk) and reveal permanently as
  they surface. Purely visual; solver and par untouched.
- **The Locked Bottle** (levels 205, 215, … 495, and one shape in six in
  endless) — the first filled bottle is padlocked and cannot be poured into
  or out of until the player has **sealed** one other bottle (two from level
  321). The lock is a pure function of the board (`lockActive`), so undo
  re-locks, the solver needs no extra state, every existing heuristic stays
  admissible, and A* is audited against brute force under lock rules. While
  locked the bottle is fingerprinted separately; once open it is an ordinary
  tube again. Rendered as a dark plate with a gold padlock and one dot per
  seal still needed; opening swells and fades the plate with a sparkle and
  the unlock chime. Tapping it explains why (throttled toast).
- **The One-Way Flask** (levels 267, 277, … 497, and one endless shape in
  seven) — an extra, teal-rimmed vessel with a funnel arrow, always the last
  tube: pours go in but never out, and the level is only won once it is
  **full**. A commitment mechanic: choose a colour, deliver it in order.
  Pure restriction plus a stricter win test, so every solver bound stays
  admissible; the flask is always fingerprinted separately (its contents can
  never leave); moving a whole uniform tube into the empty flask is allowed
  as a useful move because it is a real choice, not relabelling. Audited
  against brute force. Tapping it as a source explains why (throttled toast).
- All four introduced by one-time toasts, staggered so players meet one idea
  at a time; all documented in "How to play".

### Screens & flow
- **Splash** — full-bleed entry art (`public/Entry.webp`) + loading bar
  driven by real boot milestones (config, save, renderer, wiring) with a
  450 ms floor so it never flashes; a returning player on a fast device is on
  the home screen in well under a second.
- **Home** — full-bleed scene art, avatar → profile card, coins/hearts pills,
  a **campaign card** (chapter name, ★ stars / max, a progress bar of levels
  cleared with its count, and the big Play button inside it) with the Daily
  challenge button at the same width beneath, purple/gold bottom nav (Shop ·
  Home · Levels). Once the campaign is done the card reads "Campaign complete
  · n endless" with a full bar.
- **Screens open at the top** — `show()` resets the screen and its scroll
  containers (map, shop) to 0 on every entry; programmatic focus uses
  `preventScroll`. The map then positions the player's current chapter header
  at the top of the list using the map's own scroller (not scrollIntoView,
  which drags every scrollable ancestor).
- **Level map** — 500 nodes in **25 named chapters of 20**
  (`src/core/chapters.ts`: an alchemist's journey from "First Pour" to "The
  Grand Elixir"), each with a header in the chapter's accent colour showing
  stars earned of 60 and a progress bar; locked chapters dim, finished ones
  tick. Auto-scrolls to the current level. Home shows the current chapter
  under the progress pill; the win screen's eyebrow reads "Chapter n · Name".
- **Chapter complete** — the first clear of a chapter's last level pays a
  one-time bonus (`chapterBonus`, 100 coins), shows a gold ribbon with the
  next chapter's name, gets the big confetti, and logs `chapter_complete`.
- **Gameplay** — candy-styled HUD, powerbar, coach + hand-pointer tutorial on
  level 1 (points at the solver's actual next move).
- **No-win detection** — after each move on small boards, the solver *proves*
  whether a winning line still exists; if not, a one-time toast says "No way
  to win from here - use Undo or Restart" (silent when inconclusive, re-armed
  by undo/new bottle). Kills the "this level is impossible" misread.
- **Gentle onboarding** — levels 1-10 are all two-empty boards; single-empty
  squeeze boards start at level 18, after the player has the skills.
- **Pour headroom** — the board layout reserves `pourRiseFor(bodyW)` (0.62
  body widths + 14 px cork allowance, at least 38 px) of clear canvas above
  the top row and solves the bottle size so rows *plus* headroom fit, so a
  bottle lifted and tilted over a top-row target never leaves the frame; the
  per-row cap is 96 px for a more compact board. Smoke test asserts the
  headroom on the two-row endless board at both viewports.
- **Button depth is inset** — every 3D "lip" (buttons, chips, power buttons,
  nav tabs, cards, dialogs) is an inset shadow inside the border rather than
  a drop shadow below it, capped at 4 px, so borders contain their controls
  consistently across the UI.
- **Sealed bottles** — completing a bottle rockets a cork up from behind the
  glass, over the mouth, and drops it into the neck with a squash and a pop
  (`BottleView.setCapped`). The cork stays as the "done" marker, comes off on
  undo, is restored silently on resume, and never appears on the cauldron.
- **Win** — level name, stars in an arc (middle raised; unearned stars as dim
  outlines), "Perfect!" or the exact move count the next star needs, coins
  counting up with the breakdown of how they were earned, Moves/Par/Time/Best
  with a gold "New best!" cell, campaign progress bar, win-streak pill, one
  big pulsing Next level button with Replay/Home underneath. DOM confetti
  rains over the dialog.
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
- **Cloud save** (`services/CloudSave.ts`, [CLOUD-SAVE.md](CLOUD-SAVE.md)) —
  whole-save backup to the player's platform account with no server of ours:
  Play Games Saved Games on Android, iCloud key-value store on iOS, reached
  through one Capacitor plugin (`native/capacitor-cloudsave`, written to the
  documented APIs but not yet compiled). Conflicts resolve by *progress*
  (clears, then stars, then pours - never coins or the clock): a fresh device
  restores silently, a device with real progress is asked which copy to keep.
  Automatic uploads hang off every save flush (debounced, flushed on
  pagehide). "Reset progress" never uploads the wipe and is never silently
  undone: it forces the ask on the next sync. Restore keeps device-bound
  state (settings, support ID, redeemed/granted ledgers unioned). Settings →
  Cloud save row (status, Sign in / Sync now, Sign out); web reads "Available
  in the Android and iOS apps". `cloud_sync` analytics. The smoke test runs
  the simulated driver (`?cloud=sim`): sign-in uploads, Reset → "Cloud save
  found" → Use cloud save → same level, skin and coins back.
- **Bottle looks** (`SKINS` in `render/theme.ts`, shop section "Bottle
  looks") — six glass skins as a long-term coin sink: Classic (free), Frosted
  300, Rose quartz 400, Amber 500, Emerald 600, Obsidian 800. A skin tints
  the rim, body, collar, cavity and cork of *plain* bottles only; the cauldron
  and one-way flask keep their own colours so they stay recognisable. Tap a
  card to buy (once) and equip; owned cards re-equip free. A mounted board
  recolours at once (`BoardView.setSkin`), and every mount re-reads the save,
  so old saves and unknown ids fall back to Classic. Shop previews are drawn
  from the same skin values. Save v15 (`cosmetics`); `skin_equip` analytics
  plus `shop_coin_spend` with item `skin.<id>`. Smoke test buys and re-equips.
- **Skip level** (150 coins, `economy.skipPrice`) — offered in the Restart
  dialog and the No-moves-left dialog on campaign and endless levels (never
  the daily, never inside the tutorial). Paying unlocks the next level and
  moves straight to it; the skipped level keeps no record, earns no stars,
  does not count toward chapter completion or achievements, costs no heart,
  and shows on the map with an amber dashed rim to come back to. A genuine
  clear later retires the skip. Without enough coins the shop opens and
  nothing is charged. Save v14 (`skipped`). Smoke test covers cost, heart,
  landing level and the map marker after reload.
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
- **Persistence** — save schema v15 with forward-compatible migrations
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
- **Profile card** — identity card with "Change look" on the card itself,
  lifetime stats as one hairline-divided panel (not eight tiles), and two
  inline actions (Achievements, How to play); Settings has its own gear.
  Opening the look-picker from a card is an *edit*: "Skip, play as guest" is
  hidden, the primary button reads "Save changes", the identity keeps its
  createdAt, no `profile_created` event fires, and an emptied name keeps the
  old name. Back from the editor returns home and restores first-run form.
- **Privacy policy in-app** — Settings → Privacy → View and the consent link
  on the look-picker open `privacy.html` inside a scrollable dialog (fetched
  from the same precached file the store listings link to, so it reads
  offline), with "Open in browser" as the secondary action. The hosted page
  stays: Google Play and the App Store require a public URL.
- **Settings layout** — identity card first (avatar, name, current level,
  "Change look"), then Sound effects / Music / Vibration / Language, then
  grouped subheads: Accessibility (colourblind aid, reduced motion), Privacy
  (anonymous usage data, privacy policy), Help & support (one row opening a
  sub-dialog with Contact us, Support ID + copy, Support code; plus Reset
  progress). Rare support tooling is one tap deeper so the main list stays
  scannable. The smoke test addresses switches by index in that order.
- **Analytics consent** — Settings → "Share anonymous usage data" (default on)
  gates every event that leaves the device.
- **Privacy policy page** — `public/privacy.html`, shipped with the build,
  linked from the consent checkbox and Settings → Privacy, precached
  by the service worker. Three bracketed placeholders (date, publisher,
  country) to fill before release.
- **How to play** — reachable from Settings *and* the profile card; covers
  pouring and sealing, stars and the "ideal" (par is never shown to players
  by that name), the heart rule, free boosters (read live from the economy),
  and both twists.
- **Content Security Policy** — injected as a `<meta>` tag at build time
  (`vite.config.ts`): scripts only from the bundle, connections only to
  PostHog, no eval. Pixi is loaded through `pixi.js/unsafe-eval` so its
  shader uniform sync works without `new Function`.
- **Render loop pauses off the game screen** — home, map and shop no longer
  draw starfield and bottles into a hidden canvas every frame. It also pauses
  while the win dialog is up: that moment otherwise ran two full-screen
  canvases (board celebration + confetti) under the dialog's backdrop blur,
  the heaviest frame in the game on a phone.
- **Performance pass (Sep 2026)** — measured with `npm run perf -- <level>
  [--headed]` (CPU profile + long tasks + frame times of a real level, the
  win screen, home, map and shop; `--headed` uses the real GPU, headless uses
  software GL which is ~10x slower and useful as a "slow phone" stand-in).
  Findings and fixes: (1) the largest steady per-frame JS cost was Pixi
  Graphics re-tessellation for the starfield and particles - both are now
  pools of tinted sprites over one shared 64x32 texture; (2) an adaptive
  render-resolution watchdog in `GameStage` drops 2 → 1.5 → 1 device pixels
  per CSS pixel when frames average over 22 ms for two consecutive 2 s
  windows, never steps back up, and is driven by measured frames rather than
  device sniffing (fires under software GL, never on a desktop GPU); (3) the
  service worker's navigation fetch now races a 2.5 s timeout against the
  cached shell, so a weak signal can no longer hold the app on the splash for
  tens of seconds; (4) the Hint button pulses while the worker is solving and
  a second tap cannot spend a second hint. Desktop GPU gameplay frames are a
  flat 6 ms median / 12 ms max; production cold boot 1.5 s (461 ms script
  evaluation), warm 1.0 s. The synchronous solver is only used by the tutorial
  hand; all hints and no-win proofs run in the worker.
- **Art budget** — `optimize-art.mjs` carries per-image quality/width
  settings; critical-path images went from 712 KB to 547 KB; home art
  preloads at low priority.
- **CI** (`.github/workflows/deploy.yml`, workflow name "CI") — on every push
  to main and every pull request: lint, typecheck, locale parity, core tests,
  production build, then the browser smoke test in Playwright's Chromium,
  now **blocking** (it has been green on the runner since the perf pass);
  smoke screenshots are kept as a 7-day artifact. Hosting is Vercel, which
  builds and deploys the same commits itself. The workflow used to also push
  to GitHub Pages and failed on `configure-pages` every run because Pages was
  never enabled on the repo; that job is gone.
- **Art pipeline** — drop PNG sources in `art/`, run
  `node scripts/optimize-art.mjs` → optimized WebP in `public/` (preloaded).
- **PWA / store-wrap readiness** — full icon set (192/512 + maskable variants
  + apple-touch-icon, generated from `art/icon*.svg` via
  `node scripts/make-icons.mjs`), complete web manifest, and an offline
  service worker (`public/sw.js`: network-first navigations, cache-first
  hashed assets; registered in production builds only). Android wrap guide:
  [WRAP-ANDROID.md](WRAP-ANDROID.md).
- **Localisation** (`src/i18n/`) — every player-facing string (about 290
  keys: HUD, dialogs, shop, achievements, settings, support, How to play)
  goes through `t()` / `tp()`; `en.ts` is the typed source of truth and any
  missing translation falls back to English. Plurals use `Intl.PluralRules`
  with per-language forms (Russian carries one/few/many/other). Twelve locales
  beyond English ship as lazy chunks (~6 KB gzipped each): es, pt, fr, de, it,
  tr, id, ru, hi, ja, ko, zh. Device language by default; Settings → Language
  overrides and reloads. Level and chapter names deliberately stay English.
- **Tests** — `test:core` (rules/solver/generator, no browser) and `test:e2e`
  (drives the real game in Edge: full flows, economy assertions, tutorial,
  persistence across reload).

### Native wrapper - Android + iOS (Capacitor 8), ads, store billing (2026-09-06)
- **Projects**: `capacitor.config.ts` (appId `com.chromaflask.app`), `android/`
  and `ios/` generated and committed; `npm run cap:sync` builds the native
  flavour of the bundle and copies it in. Android **compiles** (debug APK,
  JDK 21); iOS needs a Mac. Guide: [NATIVE-BUILD.md](NATIVE-BUILD.md).
- **Native bundle flavour** (`vite build --mode native`): Capacitor injects its
  Android bridge as an inline script, which the web CSP's `script-src 'self'`
  blocks; the native flavour allows inline scripts only. `Platform.ts`
  (`platform()`, `BUILD_TARGET`) is the one place that knows where we run.
  The service worker is skipped inside the wrapper.
- **Billing**: `NativeBillingDriver` (`@capgo/native-purchases`) for Play
  Billing and StoreKit 2, same grant → record → consume lifecycle and boot
  restore. Android purchases are deliberately not auto-consumed by the plugin
  (would lose goods on a crash before the grant); iOS late transactions
  arrive via `Payments.onPending`.
- **Ads**: `Ads.ts` seam (NoAds | Simulated `?ads=sim` | AdMob). Rewarded
  video is player-initiated only: "Watch an ad for a heart" in More Lives,
  "Watch an ad · +1 X" when a powerup is out (shop second). Interstitial on
  leaving the win screen under the pure `shouldShowInterstitial` policy (≥
  level 8, every 3 wins, 180 s gap, never daily/tutorial, never for anyone who
  has ever paid); knobs in `RemoteConfig.ads`. UMP consent + iOS ATT before
  init; "Ad privacy choices" in Settings where required. Audio and render loop
  pause under a full-screen ad. Analytics `ad_rewarded`, `ad_interstitial`.
  12 new `ads.*` strings in all 13 locales.
- **Haptics**: `haptic(pattern, cue)`; iOS routes to the Taptic Engine via
  `@capacitor/haptics`, Android keeps `navigator.vibrate` (permission added).
- **Cloud save plugin** installed as the local package `capacitor-cloudsave`
  (Package.swift added for SPM); Kotlin side compiled first time, with
  `PlayGamesSdk.initialize` now guarded so a bad APP_ID degrades to
  "unavailable" instead of crashing.
- Verified: typecheck, lint, i18n:check, test:core (12,351 checks), web +
  native builds (web entry preloads only pixi/gsap; Capacitor code is lazy),
  test:e2e, Gradle `assembleDebug`.
- **Store prep (2026-09-07)**: app id `com.chromaflask.app` confirmed by the
  publisher (Tom Boban, Canada). Real launcher icons and splashes for both
  projects from the repo art (`npm run assets:native`, outputs committed).
  Privacy policy filled in (publisher, date) with an AdMob/consent section.
  Android release config: `versionName 1.0.0`, minify + shrinkResources,
  signing from git-ignored `android/keystore.properties`; `bundleRelease`
  builds a 24 MB AAB (unsigned until the upload key exists).

---

## ⚠️ Known issues / follow-ups

| Item | Detail |
| --- | --- |
| Entry art misspelled | `art/Entry.png` bakes in "CHROME FLASK" (wrong name, and "Chrome" is a Google mark). Regenerate — ideally with **no text** so a code logotype can be overlaid. |
| Trademark search | Run "ChromaFlask" through USPTO/EUIPO + both app stores before launch. |
| Translations need native review | All 12 non-English tables in `src/i18n/locales/` were authored in-house, not by native speakers. Before a store listing in each market, have a native speaker read the table (especially `howto.body`, the shop legal text and the consent sentence). English fallback means a deleted line is never a blank, so trimming a doubtful string is always safe. |
| Native wrapper: Android emulator verified, rest pending | 2026-09-07, Android Studio 2025.1.3 + `Medium_Phone_API_36.1` emulator: app boots, campaign and daily play, **rewarded test ads play and grant** in both placements (out-of-hint flow and "Watch an ad for a heart" in More Lives; hearts were lowered via chrome://inspect → localStorage since small levels cannot be lost). Not yet exercised: billing sandbox purchases (no Play products), cloud save sign-in (placeholder project id), UMP consent form (non-EEA), interstitials, a physical phone. `ios/` is generated but uncompiled (needs a Mac). See [NATIVE-BUILD.md](NATIVE-BUILD.md) "Before the first device run". |
| Murky reveal polish (fixed 2026-09-07) | A pour moves the whole matching run, including concealed units under the visible top; two "?" vanished mid-pour and read as a glitch. `BoardView.pour` now reveals the units about to move before the bottle lifts. Completing a bottle still reveals everything (the cork means one colour). |
| Smoke test flake | `test:e2e` failed once on 2026-09-06 with `window.__cf` undefined right after `start(2)` (post-resume step) and passed on rerun. Timing, not a regression; if it recurs, lengthen the wait after the level-intro. |
| Store ids are placeholders | AdMob app/unit ids are Google's sample ids (test mode switches off automatically once replaced), the Play Games project id is zeros, and `appId` `com.chromaflask.app` must be confirmed before the first upload - it is permanent. |
| Receipt validation | Client-side purchase grants are fine for launch but spoofable; add a server verification endpoint before revenue scales. |
| Full audit | [AUDIT.md](AUDIT.md) (2026-09-05) — findings by area with a P0/P1/P2 roadmap. P0 and P1 complete (lazy Pixi deferred). P2 in progress: L5 endless mode done; next daily challenge, chapters, achievements. |

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

1. **First device run of the native wrapper** (code side is complete, see
   [NATIVE-BUILD.md](NATIVE-BUILD.md)): Android Studio → run on a phone,
   then Xcode on a Mac. Fix whatever the real SDKs disagree with, then the
   accounts: Play Console + merchant profile, App Store Connect, AdMob app +
   ad units, Play Games project, the 5 SKUs from `IAP_CATALOG` in both
   consoles, signing keys.
2. **Store listing & compliance** — privacy policy URL (now mentioning
   AdMob), data-safety forms with the ads SDK declared, content rating,
   screenshots. Checklist: [STORE-RELEASE.md](STORE-RELEASE.md).
3. **Wildcard drop mechanic** — same rigor as the Cauldron (rules, heuristic
   proof, BFS audit).
4. **Leaderboard** (platform services) → **Collection** → **Teams** (traction-gated).

---

## Definition of done for any change

`npm run typecheck && npm run lint && npm run test:core && npm run build` —
plus `npm run test:e2e` when flows change. Level/curve changes must keep
`test:core` green: that suite *is* the proof the campaign is correct.
