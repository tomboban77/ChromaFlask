# ChromaFlask — Store Release & Compliance Checklist

A working checklist for shipping ChromaFlask to Google Play and the Apple App
Store without policy or legal trouble. Revisit before every store submission.

## 1. Original IP (avoiding legal disputes)

ChromaFlask uses **only original assets**, all authored in this repository:

- **Name**: "ChromaFlask" — run a trademark search (USPTO TESS, EUIPO, and the
  app stores themselves) before launch and register the mark if the game gains
  traction.
- **Characters**: the "Chroma Drops" (three droplet mascots) are original
  vector art defined in `index.html` (`#cf-drop`). They are deliberately *not*
  cats, wizards, or anything resembling the mascots of existing sort games.
- **Logo / splash / shop / UI**: all drawn in code (SVG + CSS). No third-party
  images, fonts beyond system fonts, or sounds are bundled.
- **Game mechanics are not copyrightable** — a liquid-sort puzzle is fine to
  make — but *expression* is protected. Never copy another game's art, sounds,
  wording, store screenshots, or trade dress. Reference screenshots are used
  for layout inspiration only; nothing is traced or reproduced.
- Keep proof of authorship: this git history documents that every asset was
  created here.

## 2. Payments (hard store requirements)

- **Digital goods must use platform billing.** Google Play requires Play
  Billing; Apple requires StoreKit/In-App Purchase. Never link to an external
  checkout for coins/boosters — this is the single fastest way to get removed.
- The code enforces this: `src/services/Payments.ts` only has store-billing
  drivers. The web build shows "purchases unavailable" instead of a card form.
- **Both stores ship the Capacitor wrapper** ([NATIVE-BUILD.md](NATIVE-BUILD.md)).
  Inside it `NativeBillingDriver` talks to Google Play Billing and StoreKit 2
  through `@capgo/native-purchases` and shows the store's localized prices.
  Create the five product ids from `IAP_CATALOG` as *consumable* in-app
  products in **both** the Play Console and App Store Connect - ids must
  match exactly. (The older `PlayBillingDriver` remains for a web-only TWA
  listing, see WRAP-ANDROID.md.)
- **iOS**: the Xcode deployment target is set to **iOS 15.4** (Capacitor's
  default is 15.0): the stylesheet relies on `inset`, flex `gap`,
  `aspect-ratio` and unprefixed `appearance`, and below 15.4 the layout
  collapses. `ios.scrollEnabled: false` in `capacitor.config.ts` keeps the
  web view itself from rubber-banding; the map, shop and dialogs scroll
  internally.
- **Android**: the CSS floor is Chrome 105 (`:has()` is gone, but
  `aspect-ratio`/`inset` still need 88+). Chrome auto-updates, so this only
  matters for devices with updates disabled.
- **Server-side receipt validation** is strongly recommended before granting
  large coin packs at scale — plan a small backend endpoint before revenue
  grows (client-only grants are acceptable for launch, but are spoofable).
- **Interrupted purchases are restored automatically.** On every boot the
  app asks the store for unconsumed purchases and grants anything that was
  paid for but never delivered (app killed between the payment sheet and the
  grant), exactly once. Test this with a license tester: buy, force-stop the
  app before the toast, relaunch, expect "Your purchase has been restored".
- **No deceptive pricing**: do not show fake "90% OFF" strikethrough prices
  unless there is a genuine former price. We use "Popular"/"Best value" badges
  instead.
- Restore/refund behaviour: all our products are consumables, consumed on
  grant. Document this in the store listing FAQ.

## 3. Store listing requirements

- [ ] **Privacy policy URL** (required by both stores). The page ships with
      the build as `public/privacy.html` and is linked from the consent
      checkbox and Settings; once deployed it lives at
      `https://YOUR-DOMAIN/privacy.html` — paste that URL into both consoles.
      **Fill in the three bracketed placeholders** (date, publisher name,
      country) before release. What it must say, because it is what
      the build does: progress is stored on-device; **anonymous usage
      analytics are sent to PostHog (US)** keyed by the random support ID,
      with no name, email or device identifiers; the choice is shown as a
      checkbox (on by default) on the first-run profile screen and can be
      changed any time in Settings → "Share anonymous usage data". If a
      strict opt-in is required for a market, flip the `checked` attribute
      on `#analytics-consent` in `index.html`.
- [ ] **Google Play Data safety form** / **Apple privacy nutrition label** —
      must match reality. Currently: **App interactions** (levels played,
      purchases, errors) and **Device or other IDs** (the random support ID)
      are *collected*, *not shared*, *not linked to identity*, used for
      analytics and app functionality; deletable by the player (Settings →
      Reset progress does not clear it — say so, or wire a "delete my data"
      request to your PostHog project). No data is collected while the
      Settings toggle is off. **The native apps also embed Google AdMob**:
      declare its collection (advertising ID, device identifiers, app
      activity for ads) as *shared with Google* for advertising, per
      Google's published AdMob data-safety guidance, and on iOS answer the
      privacy label's tracking questions accordingly (ATT is requested).
- [ ] **Content rating questionnaires** (IARC on Play): puzzle, no violence —
      expect Everyone/4+. Declare that the app contains in-app purchases
      **and ads**.
- [ ] **"Contains ads" declaration**: **yes** for the native apps (AdMob
      rewarded video and interstitials; see NATIVE-BUILD.md for the policy).
      The web build has no ads. Ads are capped to `MaxAdContentRating.General`
      in code; keep the AdMob console's app-level rating in step.
- [ ] **Ads consent**: the UMP consent form is shown where the law requires
      it (EEA/UK) and "Ad privacy choices" appears in Settings there; the
      privacy policy must mention AdMob and personalised/non-personalised
      ads. Set up the GDPR and US-state messages in AdMob → Privacy &
      messaging before release, or `canRequestAds` stays false in Europe.
- [ ] **Families/children**: the art style appeals to kids. If you declare a
      target age group that includes children, both stores restrict IAP
      prompts, analytics, and ads sharply. Recommended: target 13+ in the
      questionnaire unless you specifically design for kids.
- [ ] Screenshots/feature graphic: use only our own captures of ChromaFlask.

## 4. Monetization fairness (policy + player trust)

- Hearts regenerate for free (1 per 30 min, max 5), are lost only on a
  genuinely failed attempt (a dead-ended or provably unwinnable board), and
  level 1 + the tutorial never cost a heart — the game is fully playable
  without paying.
- Every real-money item can also be earned: coins come from wins; boosters
  are purchasable with coins.
- Prices, free allowances, and regen timing are tunable in
  `src/core/progression.ts` and via `RemoteConfig` without a client update.

## 5. Technical pre-flight

- [ ] `npm run build` clean; `npm run test:core` and `npm run test:e2e` pass.
- [ ] Test on a low-end Android device (Pixi WebGL fallback, 60fps pours).
- [ ] TWA: verify `assetlinks.json` digital asset links, offline behaviour,
      and that the Digital Goods API returns the five SKUs.
- [ ] iOS wrapper: audio unlock on first gesture, safe-area insets, StoreKit
      sandbox purchase of each product. Confirm buttons show their pressed
      state, and that the splash wordmark and PERFECT banner render as
      gradient text (not solid boxes).
- [ ] Android: set the system font size to Largest and check the HUD pills,
      power buttons and bottom nav do not overflow (Chrome scales px text
      with the OS setting; iOS does not). Test once on a Samsung device,
      whose `system-ui` font is wider than Roboto.
- [ ] Version bump in `package.json` + store build numbers.
