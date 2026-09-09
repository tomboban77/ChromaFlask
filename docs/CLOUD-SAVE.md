# Cloud save

Progress backed up to the player's platform account and restored on any of
their devices - with **no server of ours**. Storage is the platform's:

| Platform | Storage | Account | Interactive sign-in? |
| --- | --- | --- | --- |
| Android | Play Games Services **Saved Games** (a snapshot in the player's Google Drive app data) | Google Play Games | Yes, once (Play Games sign-in sheet) |
| iOS | **iCloud key-value store** (`NSUbiquitousKeyValueStore`) | The device's iCloud account | No - available whenever iCloud is signed in on the device |
| Web | none | - | The Settings row reads "Available in the Android and iOS apps" |

The game reaches both through one Capacitor plugin, `CloudSave`, in
[`native/capacitor-cloudsave`](../native/capacitor-cloudsave). The web app
never knows which platform it is on.

> **The plugin also carries the leaderboard** (`isLeaderboardAvailable`,
> `submitLeaderboardScore`, `showLeaderboard`), despite the package name.
> On Android a leaderboard needs exactly the same Play Games sign-in as saved
> games, so a second plugin would mean two copies of the auth handling and two
> consent prompts for one account. Game side: `src/services/Leaderboard.ts`;
> behaviour and the level-45 gate are in [STATUS.md](STATUS.md).

> **Wrapper decision.** iOS can only be shipped as a WKWebView wrapper, and
> Android cloud save needs a native bridge a Trusted Web Activity cannot give.
> Both stores therefore ship the **same Capacitor wrapper**. The TWA guide
> ([WRAP-ANDROID.md](WRAP-ANDROID.md)) is superseded for the app build; its
> Play Billing driver (Digital Goods API) must move to a Capacitor billing
> plugin as part of the wrap - see "Follow-ups" below.

## What is built and verified (web side)

`src/services/CloudSave.ts`:

- **Driver seam** - `NoCloudDriver` (web), `SimulatedCloudDriver` (dev and
  `?cloud=sim`: a second localStorage slot stands in for the cloud),
  `NativeCloudDriver` (the Capacitor plugin). `pickCloudDriver()` chooses.
- **Unit of sync** is the whole `SaveData` blob (a few KB of JSON) plus
  `updatedAt` and a device label.
- **Conflict rule** is progress, never the clock: `progressScore` = levels
  cleared, then stars, then pours. Coins are deliberately excluded (spending
  is not regress).
  - Cloud further along and this device essentially fresh (no clears, fewer
    than 10 pours) → **restore silently** and reload. A new phone gets its
    progress back without a question.
  - Cloud further along and this device has real progress → **ask**: the
    "Cloud save found" dialog shows both copies (level, stars, coins, date,
    device) and the player picks; the other copy is overwritten.
  - Local at least as far along → **upload**.
- **Automatic uploads** hang off `SaveService.onFlush`, debounced 4 s, and
  are flushed on `pagehide`. Failures are quiet; the next change retries.
- **Reset semantics.** "Reset progress" (Settings or a support code) never
  uploads the wipe and never gets silently undone: it sets a `resetPending`
  flag that blocks automatic uploads and forces the *ask* path on the next
  sync. The player's choice (either way) clears the flag.
- **Restore keeps device-bound state**: settings, support ID, and the
  redeemed-code / granted-purchase ledgers are unioned so nothing is claimed
  twice. A half-played level from the other device is dropped.
- **UI**: Settings → Cloud save (status line + Sign in / Sync now, Sign out).
  `cloud_sync` analytics event with reason and result.
- **Verified** by `npm run test:e2e`: sign-in uploads; Reset progress →
  reload → "Cloud save found" dialog → Use cloud save → home with the same
  level, bought skin and coins. Runs on both viewports.

## Native plugin (Android compiles; iOS unbuilt)

`native/capacitor-cloudsave` is a standard Capacitor plugin: TypeScript
definitions, Android (Kotlin, Play Games Services v2 `SnapshotsClient`) and
iOS (Swift, `NSUbiquitousKeyValueStore`). Installed into the app as the local
package `capacitor-cloudsave`. The **Kotlin side compiles** as part of the
Android build (2026-09-07); `PlayGamesSdk.initialize` is wrapped so a missing
or placeholder `APP_ID` degrades to "cloud save unavailable" instead of
crashing at start-up. The **Swift side has never been compiled** - that needs
Xcode on a Mac, so expect a short round of fixes there. Neither side has run
against a real account yet: the Play Games project id in `strings.xml` is
still zeros. The JS contract both must satisfy is in `CloudSave.ts`
(`CloudSavePlugin` interface) and in the plugin's `definitions.ts`.

### Contract

```
isAvailable()      -> { available: boolean }
currentAccount()   -> { account: string | null }
signIn()           -> { account: string | null }   // null = player backed out
load()             -> { data: string | null, updatedAt: number, device: string }
store({ data, updatedAt, device }) -> void
signOut()          -> void
```

Any rejection is treated by the game as "not available right now".

## Setup checklist

### Android (Play Games Services)

1. Play Console → your app → **Play Games Services → Setup and management →
   Configuration**. Create a games project; note the **Game ID**
   (`APP_ID` in the manifest meta-data).
2. Under **Credentials**, add an Android OAuth client for the app's package
   name with the **upload key SHA-1 and the Play App Signing SHA-1**. Both,
   or sign-in fails only in production. Upload key SHA-1 (created 2026-09-07):
   `3D:C0:32:F5:59:93:61:6B:7F:11:71:58:68:0C:0E:7D:74:3E:2C:7E`; the Play-held
   one is `DD:80:C9:8B:A0:FB:38:AF:FE:68:A8:19:14:C8:01:29:69:FA:E2:4F` (pre-filled
   by the Add credential dialog on 2026-09-08 — confirm it against Play Console →
   Test and release → App integrity). One OAuth client carries one SHA-1, so this
   is two OAuth clients and two PGS credentials, not one of each.
3. Enable **Saved Games** in the games project configuration (it is off by
   default and cannot be turned on after publishing the games project).
4. Add testers (Play Games Services → Testers) until the games project is
   published; unpublished projects only work for listed accounts.
5. Wrapper: `com.google.android.gms:play-services-games-v2:20.+` dependency,
   `<meta-data android:name="com.google.android.gms.games.APP_ID"
   android:value="@string/game_services_project_id"/>` in the manifest, and
   `PlayGamesSdk.initialize` on app start (done in the plugin's `load()`).

### iOS (iCloud)

1. Xcode → target → **Signing & Capabilities → + iCloud**, tick **Key-value
   storage**. This adds `com.apple.developer.ubiquity-kvstore-identifier` to
   the entitlements; the plugin uses the default store.
2. Nothing to configure in App Store Connect beyond the capability. The
   store is per Apple ID and syncs across the player's devices automatically;
   the plugin listens for external changes and the game re-syncs on resume.
3. Limits: 1 MB total, 1 KB per key by default for the *fast* store - the
   plugin stores the save as **one key under the 1 MB / 1024-key store
   limits** (a full save is well under 100 KB). If the save ever grows past
   that, switch the iOS side to CloudKit private database with the same
   contract.

## Follow-ups

- ~~Wrap with Capacitor~~ Done - `android/` and `ios/` exist and the plugin is
  installed as the local package `capacitor-cloudsave` (see
  [NATIVE-BUILD.md](NATIVE-BUILD.md)). Billing moved to `NativeBillingDriver`
  (`@capgo/native-purchases`) for both platforms.
- **Leaderboards** can reuse the same Play Games / Game Center sign-in.
- **Transfer code** (export/import the save as a text code) would give web
  players a no-account fallback; not built.
