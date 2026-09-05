# ChromaFlask

A mobile-first liquid-sort puzzle for the web. PixiJS renders the board, GSAP
choreographs the pours, and the HUD is plain DOM so text stays crisp and
accessible.

A 200-level campaign with two signature twists — **the Cauldron** (accepts any
colour, must be emptied to win) and **murky potions** (colours hidden until
they surface) — plus hearts, coins, a store-billing shop, tutorial, and a full
candy-style UI.

- **What's done / what's left:** [docs/STATUS.md](docs/STATUS.md)
- **Store submission & legal checklist:** [docs/STORE-RELEASE.md](docs/STORE-RELEASE.md)

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm run preview` | Serve the built output |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run levels:build` | Precompute all 200 boards + optimal lines into `src/core/campaign.json` |
| `npm run test:core` | Rules/solver/generator suite, incl. proving `campaign.json` (no browser needed) |
| `npm run test:e2e` | Drives the real game in Edge, plays a level to a win |

`dist/` is fully static — any CDN or static host will serve it. Paths are
relative (`base: './'`), so it also works from a subdirectory.

## Architecture

```
src/
  core/        Pure TS. No engine imports, no DOM. Portable and unit-testable.
    board.ts        pour rules (incl. cauldron BoardRules), win/deadlock, hashing
    solver.ts       A* with admissible heuristics -> optimal move counts
    generator.ts    seeded deal, validated solvable, computes par
    levels.ts       the 200-level campaign curve (breathers, squeezes, twists)
    progression.ts  stars, coin economy, lives constants, coin-shop catalog
  services/    Driver-based seams. Swap a driver, not the call sites.
    SaveService     LocalStorage | in-memory fallback | (later) cloud
    AuthService     guest profile | (later) OAuth
    Analytics       console | (later) GA4/Amplitude
    RemoteConfig    static defaults | (later) fetched live tuning
    Payments        Google Play Billing | dev simulator | unavailable on web
  render/      PixiJS layer.
    GameStage       renderer, layer stack, frame loop, resize
    BottleView      bottle + cauldron silhouettes, liquid, murk, glyphs
    BoardView       layout, input, GSAP pour choreography, powerups, rules
    effects.ts      pour stream, particles, starfield
    theme.ts        palette and vessel proportions
  ui/          DOM overlay: screens, modals, toasts, tutorial, confetti
  audio/       Fully synthesised SFX and music (no audio assets at all)
```

The `core/` boundary is deliberate. The puzzle logic, solver and progression have
zero knowledge of Pixi or the DOM, so a future native port or renderer swap
touches only `render/`.

### Notable implementation details

**Every level is provably solvable, and precomputed.** `generateLevel` deals a
seeded random board and then actually solves it before accepting it.
Generation is deterministic per level id, so all players get identical boards
- which is why the whole campaign is computed once at build time
(`npm run levels:build` → `src/core/campaign.json`) and costs nothing at level
start. The generator stays as the validated fallback and the future endless
mode; the solver runs in a Web Worker for hints and no-win proofs.

**Par is genuinely optimal.** The solver is A* over states canonicalised by
sorting tube contents (tubes are interchangeable, which collapses a huge amount
of the search space). Its heuristic — total colour runs minus colour count — is
admissible, because a single pour merges at most one pair of runs. Under
cauldron rules a second admissible bound applies (every run inside the cauldron
needs a pour to leave), and the max of the two is used. Offline, the exact
search runs with no time budget, so all 200 stored pars are proven optimal; the
core test suite asserts that flag and audits pars against an independent BFS
under both rule sets. A 3-star target is a real mathematical claim, not a guess.

**The liquid surface stays level while the bottle tilts.** Bands are emitted in
bottle-local space as quads between two parallel lines whose normal is
`(sin θ, cos θ)`, so a world-horizontal strip stays horizontal at any tilt while
the clip mask still carves it to the glass. This is what makes a pour read as
liquid rather than a rotating sticker.

**Game state never lives in an animation callback.** A GSAP timeline can render
a zero-duration `.call()` twice, which originally double-fired the win and paid
the reward out twice. The pour is now sequenced with `await` across four phases,
so the landing logic runs exactly once. `test:e2e` asserts this.

**No audio assets.** Every sound is built at runtime from oscillators and
filtered noise, including the ambient music (scheduled with lookahead against
the audio clock). Nothing to download or decode.

## Accessibility

- Colourblind aid draws a distinct shape per colour; the palette is also ordered
  so the earliest levels use maximally separated hues
- Reduced motion honours `prefers-reduced-motion` and has its own toggle
- Touch targets are padded to at least 44 px regardless of bottle size
- Modals set `role="dialog"`/`aria-modal` and move focus; Escape closes
- Desktop keyboard: number keys select a bottle, Escape deselects
- Safe-area insets respected via `viewport-fit=cover` + `env()`

## What is stubbed

Local-only by design. There is no backend: saves go to `localStorage` (falling
back to memory in private browsing, with the player warned) and the profile is
a local guest identity. Analytics go to PostHog over its plain capture endpoint
(no SDK), keyed by the save's random support ID and gated by the "Share
anonymous usage data" setting; uncaught errors are reported the same way. Each
of these sits behind a driver interface, so adding real auth, cloud save or a
different analytics vendor means writing one driver rather than editing
gameplay code.

Real-money purchases only exist through platform billing: the Play Billing
driver activates inside an Android TWA, dev builds simulate the store behind an
explicit confirm dialog, and plain-web production hides paid items entirely.
There is deliberately no card/PSP checkout — both app stores forbid it for
in-game digital goods. Details and remaining launch work: [docs/STATUS.md](docs/STATUS.md).

## Toolchain notes

- **TypeScript is pinned to 6.0.3, not 7.x.** TS 7 (the Go-native compiler) is
  production-ready as a CLI, but `typescript-eslint` still peer-caps at
  `<6.1.0` because it consumes the programmatic API. Revisit at TS 7.1.
- **Vite 8 uses Rolldown**, which requires the *function* form of
  `manualChunks`; the object form throws.
- `baseUrl` is deprecated in TS 6, so `paths` are declared relative (`./src/*`).
- Custom Pixi v8 filters need both a `glProgram` and a `gpuProgram` to survive a
  WebGPU fallback. All effects here are geometry-based instead, so they render
  identically on WebGL and WebGPU with no shader maintenance.
