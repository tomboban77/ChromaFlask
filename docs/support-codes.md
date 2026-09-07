# Customer support without a backend

Prism Potions has no server: every save lives in the player's own browser
(localStorage). Support therefore works through **signed one-time codes** the
player redeems inside the game.

## The player's side (Settings → Help & support)

- **Support ID** — a stable anonymous 8-character ID (e.g. `M9T4-VQ2H`),
  minted with the save. Shown with a Copy button.
- **Contact us** — opens their mail app with the support address, their ID,
  progress and save version pre-filled.
- **Support code** — input where they redeem the code you send back.
- **Reset progress** — self-service full reset with a confirm dialog
  (settings and support ID survive). No email needed for this case.

## Your side

When a support email arrives, note the Support ID in it and run:

```
node scripts/make-support-code.mjs <supportId> reset            # wipe progress
node scripts/make-support-code.mjs <supportId> level 87         # unlock through level 87
node scripts/make-support-code.mjs <supportId> coins 500        # goodwill coins
node scripts/make-support-code.mjs <supportId> lives            # refill hearts
node scripts/make-support-code.mjs <supportId> infinite 24      # unlimited hearts, 24h
node scripts/make-support-code.mjs <supportId> level 87 --days 30   # custom expiry
```

Email back the printed code (looks like `CF-XXXXX-XXXXX-XXXXX-XXXXX`).

## Properties

- **Device-bound**: the signature covers the support ID, so a code works only
  on the device that asked. Codes never contain the ID, so they stay short.
- **Expiring**: 14 days by default (`--days` to change).
- **Single-use**: the save remembers redeemed codes.
- **Typo-tolerant**: the alphabet has no I, L, O or U; lowercase and confusable
  characters are normalized on entry.

## Accepted trade-off

The HMAC secret ships in the client bundle, so someone reading the source can
forge codes **for themselves** — the same person can already edit their own
localStorage, so nothing new is exposed. Revisit if codes ever gate anything
competitive or real-money. If the secret must rotate, change it in BOTH
`src/services/Support.ts` and `scripts/make-support-code.mjs` (old unexpired
codes stop working).

## Configuration

- Support inbox: `SUPPORT_EMAIL` in `src/services/Support.ts`
  (currently tomboban77@gmail.com).
- Analytics: `POSTHOG_KEY` in `src/services/Analytics.ts` (set, US cloud).
  The player's support ID is the analytics `distinct_id`, so a support email
  can be matched to its funnel in PostHog.
- `npm run test:core` round-trips real generated codes through the client
  verifier, so the script and the game cannot silently drift apart.
