# capacitor-cloudsave

Capacitor plugin that gives ChromaFlask one `CloudSave` API over two platform
stores:

- **Android** - Play Games Services v2 Saved Games (`SnapshotsClient`).
- **iOS** - iCloud key-value store (`NSUbiquitousKeyValueStore`).

The game-side consumer and the full contract are documented in
[`docs/CLOUD-SAVE.md`](../../docs/CLOUD-SAVE.md).

> **Status: written to the documented APIs, not yet compiled.** There is no
> Android Studio or Xcode on the machine this was authored on. When the
> Capacitor wrapper project exists, add this folder as a local plugin
> (`npm install ./native/capacitor-cloudsave` from the wrapper) and expect a
> short round of compiler fixes.

## Layout

```
package.json          plugin package (peer: @capacitor/core)
src/definitions.ts    TypeScript contract
src/index.ts          registerPlugin('CloudSave')
src/web.ts            web fallback: isAvailable -> false
android/              Kotlin plugin + Gradle module
ios/Plugin/           Swift plugin
CapacitorCloudsave.podspec
```

## Semantics the native side must keep

- `isAvailable()` never throws; it answers whether this device *could* cloud
  save (Play Services present / iCloud signed in). It does not sign in.
- `currentAccount()` returns the account label without any UI.
- `signIn()` may show platform UI. Resolving `{ account: null }` means the
  player cancelled; that is not an error.
- `load()` returns `{ data: null }` when there is no snapshot yet.
- `store()` overwrites the single snapshot. The game decides *what* to store;
  the plugin never merges.
- `signOut()` on Android signs out of Play Games for this app. On iOS there
  is no per-app iCloud sign-out; the plugin records an "opted out" flag so
  `currentAccount()` returns null until `signIn()` is called again.
