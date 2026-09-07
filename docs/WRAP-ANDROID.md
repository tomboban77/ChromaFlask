# Wrapping Prism Potions for Google Play (TWA)

> **Superseded for the store build.** Cloud save needs a native bridge that a
> Trusted Web Activity cannot provide, and iOS needs a WKWebView wrapper in
> any case, so both stores ship the same **Capacitor** wrapper - see
> [CLOUD-SAVE.md](CLOUD-SAVE.md). This guide remains valid for a web-only
> Android listing without cloud save, and its Play Console prerequisites
> (merchant profile, signing key, SKUs) still apply.

The Android build is a **Trusted Web Activity**: the real Chrome engine
rendering our deployed web app full-screen, packaged as a normal Play Store
app. The code is already prepared — manifest, icon set, offline service
worker, and a Play Billing driver that activates automatically inside a TWA.

## 0. Prerequisites (one-time, your accounts)

- [ ] Deploy `dist/` to a permanent HTTPS domain (any static host/CDN).
      The domain becomes part of the app's identity — pick the final one.
- [ ] Google Play Console developer account ($25 one-time).
- [ ] In Play Console: **set up the merchant profile** (bank account, tax
      info) — this is where purchase payouts land.
- [ ] Node 18+ and a JDK (Bubblewrap installs its own if missing).

## 1. Generate the Android project

```bash
npm run build            # produces dist/
# deploy dist/ to https://YOUR-DOMAIN, then:
npx @bubblewrap/cli init --manifest https://YOUR-DOMAIN/manifest.webmanifest
```

Answers that matter when prompted:

| Prompt | Answer |
| --- | --- |
| Application ID | `com.yourcompany.chromaflask` (permanent — cannot change later) |
| Display mode | `standalone` |
| Orientation | `portrait` |
| Signing key | Let Bubblewrap create one. **Back it up + its passwords.** |
| Include support for Play Billing? | **Yes** (adds the `PLAY_BILLING` feature + Digital Goods API) |

Then:

```bash
npx @bubblewrap/cli build     # produces app-release-bundle.aab
```

## 2. Digital Asset Links (removes the browser bar)

The TWA is only "trusted" once the site vouches for the app. Get the SHA-256
fingerprint of your signing key:

```bash
keytool -list -v -keystore android.keystore -alias android
```

Serve this file at `https://YOUR-DOMAIN/.well-known/assetlinks.json`
(create `public/.well-known/assetlinks.json` in this repo so it deploys with
the site):

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.yourcompany.chromaflask",
    "sha256_cert_fingerprints": ["AA:BB:CC:...your fingerprint..."]
  }
}]
```

> When Play App Signing re-signs your bundle, add the **Play-provided**
> SHA-256 (Play Console → Setup → App integrity) to the array too, or the
> production app will show a URL bar.

## 3. In-app products

Play Console → Monetize → In-app products. Create these five **consumable**
products — the ids must match `IAP_CATALOG` in `src/services/Payments.ts`
exactly:

| Product ID | Suggested price |
| --- | --- |
| `cf.bundle.starter` | $1.99 |
| `cf.bundle.alchemist` | $7.99 |
| `cf.coins.small` | $2.99 |
| `cf.coins.medium` | $9.99 |
| `cf.coins.large` | $19.99 |

No code changes needed: `PlayBillingDriver` detects the Digital Goods API,
pulls localized prices from the store, and consumes purchases on grant.

## 4. Test before release

- [ ] Internal testing track: upload the `.aab`, add your Gmail as a tester.
- [ ] License testers (Play Console → Settings → License testing) can make
      **test purchases without being charged** — verify every SKU grants
      correctly and can be repurchased (consumable).
- [ ] Airplane-mode the phone after first launch: game must still start and
      play (service worker offline shell).
- [ ] Confirm no URL bar (asset links working) and haptics fire on pours.
- [ ] Run through `docs/STORE-RELEASE.md` (privacy policy, data safety,
      content rating, screenshots) before promoting to production.

## iOS (later)

Capacitor wrapper + a `StoreKitDriver` implementing the `PaymentDriver`
interface, five matching products in App Store Connect, and a native haptics
bridge (web vibration is unsupported on iOS). Tracked in `docs/STATUS.md`.
