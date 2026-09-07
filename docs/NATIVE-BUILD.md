# Native builds (Google Play + App Store) with Capacitor

Both stores ship the same **Capacitor 8** wrapper around the web game. The
web bundle is built once in "native" flavour and copied into `android/` and
`ios/`; native SDKs (billing, ads, haptics, cloud save) are reached through
Capacitor plugins that the game loads only when it detects the wrapper.

```
capacitor.config.ts        appId com.prismpotions.app, webDir dist, iOS scroll off
android/                   Android Studio project (generated, committed)
ios/                       Xcode project, Swift Package Manager (generated, committed)
native/capacitor-cloudsave local plugin: Play Games Saved Games / iCloud KV store
src/services/Platform.ts   platform() -> 'web' | 'android' | 'ios'; BUILD_TARGET
src/services/Ads.ts        AdMob driver + interstitial policy + rewarded flows
src/services/Payments.ts   NativeBillingDriver (Play Billing / StoreKit 2)
src/ui/dom.ts              installNativeHaptics() (iOS Taptic Engine)
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run build:native` | Typecheck + `vite build --mode native` into `dist/` |
| `npm run cap:sync` | `build:native`, then `cap sync` (copies `dist/` into both projects, wires plugins) |
| `npm run android:open` | Opens `android/` in Android Studio |
| `npm run ios:open` | Opens `ios/App` in Xcode (Mac only) |
| `cd android && gradlew assembleDebug` | Debug APK from the command line (`./gradlew` on Mac/Linux) |

Gradle needs **JDK 21** (Capacitor 8 compiles for Java 21; a JDK 17 fails with
"invalid source release: 21"). Android Studio uses its bundled one; from a
terminal point `JAVA_HOME` at it, e.g. on Windows
`C:\Program Files\Android\Android Studio\jbr`. The Android SDK path lives in
`android/local.properties` (git-ignored, machine-specific).

Always `cap:sync` after changing web code; the native projects hold a *copy*
of `dist/`. `npm run build` (no `:native`) is the web deploy and must not be
synced into the apps - its CSP blocks Capacitor's bridge (below).

### Why a separate native bundle

Capacitor's Android bridge is injected into `index.html` as an **inline
`<script>`**. The web build's `Content-Security-Policy` meta has
`script-src 'self'`, which blocks it: no `window.Capacitor`, no plugins, and
every native feature silently reports "unavailable". `--mode native` adds
`'unsafe-inline'` to `script-src` only (everything else in the policy stays)
and sets `import.meta.env.MODE === 'native'`, which `Platform.ts` exposes as
`BUILD_TARGET`. At runtime the game additionally checks `window.Capacitor`
(`platform()`), so a native bundle opened in a browser still behaves as web.

The native bundle also skips the service worker (assets ship inside the app;
a worker could only serve a stale copy after an update).

## Icons and splash screens

`npm run assets:native` (scripts/make-native-assets.mjs) renders every
launcher icon and splash for both projects from the repo's art and the
outputs are committed:

- `art/icon.svg` → Android legacy icon; `art/icon-maskable.svg` → iOS icon
  (flattened, Apple masks the corners), Android round icon, and the adaptive
  foreground with the flask fitted to the 66/108 safe zone over a matching
  purple gradient background.
- `art/Entry.png` → every splash, cover-cropped, so the native splash hands
  over to the web boot screen (which shows the same art) without a jump.
  Android 12+ additionally shows the launcher icon on `#0a0e2a` (the boot
  background) via `windowSplashScreenBackground`.

Re-run after changing any of those sources. Entry.png is 941 px wide, so 3x
iPhones upscale it - same as the web boot screen does today; higher-res boot
art improves both at once.

## Release build (Android)

1. Create the upload key once, outside the repo, and back it up with its
   passwords - losing it means losing the ability to update the app unless
   Play App Signing is enrolled (it is, by default, for new apps):
   ```
   keytool -genkeypair -v -keystore prismpotions-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Create `android/keystore.properties` (git-ignored):
   ```
   storeFile=../prismpotions-upload.jks
   storePassword=...
   keyAlias=upload
   keyPassword=...
   ```
3. Bump `versionCode` (must increase every upload) and `versionName` in
   `android/app/build.gradle`, run `npm run cap:sync`, then
   `cd android && gradlew bundleRelease` (JDK 21). The bundle lands in
   `android/app/build/outputs/bundle/release/app-release.aab`; upload it to
   Play Console → Testing → Internal testing first.

Release builds are minified and resource-shrunk; every plugin ships its own
consumer ProGuard rules, so nothing extra is needed in `proguard-rules.pro`.

## Plugins

| Plugin | Used for | Notes |
| --- | --- | --- |
| `@capgo/native-purchases` | Play Billing + StoreKit 2 | `NativeBillingDriver`; consumables only |
| `@capacitor-community/admob` | Rewarded video + interstitials, UMP consent, ATT | `AdMobDriver` |
| `@capacitor/haptics` | Taptic Engine on iOS | Android keeps `navigator.vibrate` (VIBRATE permission added) |
| `capacitor-cloudsave` (local) | Play Games Saved Games / iCloud KV | see [CLOUD-SAVE.md](CLOUD-SAVE.md) |

All are loaded with dynamic `import()` from the `native` chunk, so the web
bundle's start-up path does not include them.

## Before the first device run - placeholders to replace

Everything below is wired but carries a placeholder until the accounts exist.
Search for the value to find every spot.

| What | Where | Placeholder now |
| --- | --- | --- |
| **App id / bundle id** (permanent once published) | `capacitor.config.ts`, `android/app/build.gradle` (`applicationId`, `namespace`), `android/app/src/main/res/values/strings.xml`, `ios/App/App.xcodeproj` (`PRODUCT_BUNDLE_IDENTIFIER`) | `com.prismpotions.app` |
| **AdMob app id, Android** | `android/app/src/main/res/values/strings.xml` → `admob_app_id` | **done** 2026-09-07 (`…~7723851386`) |
| **AdMob app id, iOS** | `ios/App/App/Info.plist` → `GADApplicationIdentifier` | **done** 2026-09-07 (`…~7545204631`) |
| **AdMob ad unit ids** (rewarded + interstitial, per platform) | `src/services/Ads.ts` → `AD_UNITS` | **done** 2026-09-07; test mode now only in dev builds (emulators are test devices anyway) |
| **Play Games project id** (cloud save) | `strings.xml` → `game_services_project_id` | `000000000000` - cloud save reports "unavailable" while wrong |
| **iCloud key-value entitlement** | Xcode → Signing & Capabilities → + iCloud → Key-value storage | not added (needs a signing team) |
| **In-app products** | Play Console and App Store Connect, consumable, ids from `IAP_CATALOG` | not created |
| **Signing** | Play upload key + Play App Signing; Apple team + provisioning | none |

Also: fill the three bracketed fields in `public/privacy.html`, and add AdMob
to it (see STORE-RELEASE.md).

## Behaviour inside the wrapper

### Purchases (`NativeBillingDriver`)

The purchase lifecycle in `Payments.ts` is unchanged: sheet → grant → record
token → consume, with a boot-time restore of anything the store still holds.

- **Android**: `purchaseProduct` is called *without* `isConsumable` on
  purpose. With it the plugin consumes inside the call, before the app has
  granted anything, so a crash in between would lose the goods. Left owned
  (and acknowledged, so Play never auto-refunds) the purchase is consumed by
  `consume()` after the grant, or found by `getPurchases()` and settled on the
  next boot.
- **iOS**: the plugin finishes the StoreKit transaction inside
  `purchaseProduct`; `consume()` is a no-op and the transaction id is the
  token (recorded, so a grant is never repeated). Transactions completed
  outside the sheet (interrupted checkout, Ask to Buy approved later) arrive
  via the plugin's `transactionUpdated` event → `Payments.onPending` →
  `settleLatePurchase`.
- Prices shown in the shop are the store's localized strings.

### Ads (`Ads.ts`)

- **Rewarded video, player-initiated only**: "Watch an ad for a heart" in the
  More Lives dialog (also the out-of-hearts gate); "Watch an ad · +1 Hint/Undo/
  Bottle" when free uses and stock are both gone (the shop is the second
  choice). The reward is granted only on the SDK's `Rewarded` event, never on
  an early close. On a dead-ended board the No-moves dialog returns if nothing
  was gained.
- **Interstitial** on the way out of the win screen (Next / Replay / Home),
  decided by the pure `shouldShowInterstitial`: never before level 8, at most
  one per 3 eligible wins, at least 180 s after *any* full-screen ad, never on
  the daily or the tutorial, **never for a player who has ever paid**
  (`SaveService.hasEverPurchased`). Knobs are live-tunable via `RemoteConfig`
  (`ads.firstInterstitialLevel`, `interstitialEvery`, `minGapSeconds`,
  `rewardedLives`). An interstitial that is not already preloaded is skipped,
  never waited for.
- Around any full-screen ad the game suspends audio and pauses the render
  loop (`Ads.onAdStart/onAdEnd`).
- **Consent**: `requestConsentInfo` → UMP form if `REQUIRED` → (iOS) ATT
  prompt if still undetermined → `AdMob.initialize` with
  `maxAdContentRating: General`. Where UMP says privacy options are required
  (EEA/UK), Settings shows "Ad privacy choices" → `showPrivacyOptionsForm`.
  The GDPR/US-state messages must be configured in AdMob → Privacy &
  messaging, or `canRequestAds` stays false there and no ads load.
- Analytics: `ad_rewarded {placement, outcome}` and `ad_interstitial {level,
  outcome}` (skips are not sent).
- **Web / dev**: `NoAdsDriver` (no buttons appear). `?ads=sim` swaps in a
  simulated driver (1.2 s "video", always rewarded) and `?ads=sim-fail` makes
  loads fail, to exercise both paths in a browser.

### Haptics

`haptic(pattern, cue?)` keeps the Vibration API on the web and inside the
Android web view (permission added). On iOS `installNativeHaptics()` routes
single pulses to `Haptics.impact` (light/medium/heavy by length) and patterns
to `Haptics.notification` with the cue (`success` / `warning` / `error`).

### Back button, orientation

Android's hardware back works through the existing history guard (the web
view has history to pop). Both apps are portrait-only on phones
(`android:screenOrientation`, `UISupportedInterfaceOrientations`); iPad keeps
all orientations as the App Store requires.

## Testing

- **Ads**: with Google's sample ids in place every ad is a test ad and
  `initializeForTesting` is on; nothing needs an AdMob account. On a device,
  force the EEA consent form with `requestConsentInfo({ debugGeography: EEA,
  testDeviceIdentifiers: [...] })` temporarily.
- **Purchases**: Play → license testers (no charge); iOS → sandbox tester
  account. Test the restore path: buy, force-stop before the toast, relaunch,
  expect "Your purchase has been restored".
- **Cloud save**: needs the Play Games project + testers (CLOUD-SAVE.md);
  iCloud needs the entitlement and a signed build.
- Web checks stay as before: `npm run typecheck && npm run lint && npm run
  test:core && npm run build`, plus `npm run test:e2e`.

## Status

- Web side complete and verified by the usual checks.
- `android/` and `ios/` generated with Capacitor 8.5 and all four plugins
  synced. **Android compiles** (`gradlew assembleDebug`, JDK 21) including the
  Kotlin cloud save plugin. **iOS is uncompiled** - it needs Xcode on a Mac;
  expect the usual first-build items (signing team, iCloud entitlement) and
  possibly small Swift fixes in `native/capacitor-cloudsave/ios/Plugin`.
- Nothing has run on a device yet. Expect the first Android Studio / Xcode
  session to surface SDK setup issues (Play Games meta-data, iCloud
  entitlement, signing) rather than game-code issues.
