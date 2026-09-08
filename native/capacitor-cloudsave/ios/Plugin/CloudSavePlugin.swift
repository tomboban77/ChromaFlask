import Foundation
import Capacitor
import GameKit
import UIKit

/// Cloud save over the iCloud key-value store.
///
/// One record, stored as three keys (`save.data`, `save.updatedAt`,
/// `save.device`). The store is per Apple ID and syncs across the player's
/// devices by itself; there is no interactive sign-in. "Sign out" is modelled
/// as a local opt-out flag so the game can stop syncing on this device.
///
/// Requires the iCloud capability with Key-value storage ticked
/// (com.apple.developer.ubiquity-kvstore-identifier).
///
/// STATUS: written to the Capacitor 6 / Foundation APIs, not yet compiled -
/// see native/capacitor-cloudsave/README.md.
@objc(CloudSavePlugin)
public class CloudSavePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CloudSavePlugin"
    public let jsName = "CloudSave"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentAccount", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "store", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isLeaderboardAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "submitLeaderboardScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showLeaderboard", returnType: CAPPluginReturnPromise),
    ]

    private let store = NSUbiquitousKeyValueStore.default
    private let optOutKey = "chromaflask.cloud.optOut"
    private let dataKey = "save.data"
    private let updatedAtKey = "save.updatedAt"
    private let deviceKey = "save.device"
    private let accountLabel = "iCloud"

    override public func load() {
        // Pull any change another device pushed while we were not running.
        store.synchronize()
        // Game Center authenticates on its own terms. Setting the handler at
        // launch means its sheet (if one is needed at all) appears once, up
        // front, rather than interrupting a level later. A refusal is fine:
        // the leaderboard button then reports "not signed in" and nothing
        // else about the game changes.
        GKLocalPlayer.local.authenticateHandler = { [weak self] viewController, _ in
            guard let viewController else { return }
            DispatchQueue.main.async {
                self?.bridge?.viewController?.present(viewController, animated: true)
            }
        }
    }

    private var iCloudSignedIn: Bool {
        return FileManager.default.ubiquityIdentityToken != nil
    }

    private var optedOut: Bool {
        return UserDefaults.standard.bool(forKey: optOutKey)
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": iCloudSignedIn])
    }

    @objc func currentAccount(_ call: CAPPluginCall) {
        if iCloudSignedIn && !optedOut {
            call.resolve(["account": accountLabel])
        } else {
            call.resolve(["account": NSNull()])
        }
    }

    @objc func signIn(_ call: CAPPluginCall) {
        guard iCloudSignedIn else {
            // No iCloud account on the device: nothing we can prompt for.
            call.resolve(["account": NSNull()])
            return
        }
        UserDefaults.standard.set(false, forKey: optOutKey)
        store.synchronize()
        call.resolve(["account": accountLabel])
    }

    @objc func signOut(_ call: CAPPluginCall) {
        UserDefaults.standard.set(true, forKey: optOutKey)
        call.resolve()
    }

    @objc func load(_ call: CAPPluginCall) {
        store.synchronize()
        guard let data = store.string(forKey: dataKey), !data.isEmpty else {
            call.resolve(["data": NSNull(), "updatedAt": 0, "device": UIDevice.current.model])
            return
        }
        let updatedAt = store.longLong(forKey: updatedAtKey)
        let device = store.string(forKey: deviceKey) ?? UIDevice.current.model
        call.resolve(["data": data, "updatedAt": updatedAt, "device": device])
    }

    @objc func store(_ call: CAPPluginCall) {
        guard let data = call.getString("data") else {
            call.reject("data is required")
            return
        }
        let updatedAt = call.getInt("updatedAt").map { Int64($0) } ?? Int64(Date().timeIntervalSince1970 * 1000)
        let device = call.getString("device") ?? UIDevice.current.model
        store.set(data, forKey: dataKey)
        store.set(updatedAt, forKey: updatedAtKey)
        store.set(device, forKey: deviceKey)
        // synchronize() only schedules the upload; iCloud delivers it when it can.
        if store.synchronize() {
            call.resolve()
        } else {
            call.reject("iCloud key-value store refused the write")
        }
    }

    // ------------------------------------------------------------ leaderboard
    /// Deliberately NOT `isAvailable`, which answers for iCloud: Game Center is
    /// a separate service and one can work while the other does not. Every
    /// supported iOS version has Game Center, so this is a flat yes; whether
    /// the player is signed in is answered per call below.
    @objc func isLeaderboardAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": true])
    }

    /// Silent by design: a score is posted right after a win, and a sign-in
    /// sheet at that moment would read as a nag. Signed out resolves having
    /// done nothing; the next win retries.
    @objc func submitLeaderboardScore(_ call: CAPPluginCall) {
        guard let identifier = call.getString("leaderboardId") else {
            call.reject("leaderboardId is required")
            return
        }
        guard let score = call.getInt("score") else {
            call.reject("score is required")
            return
        }
        guard GKLocalPlayer.local.isAuthenticated else {
            call.resolve()
            return
        }
        GKLeaderboard.submitScore(
            score,
            context: 0,
            player: GKLocalPlayer.local,
            leaderboardIDs: [identifier]
        ) { error in
            if let error {
                CAPLog.print("[CloudSave] leaderboard submit failed: \(error.localizedDescription)")
            }
            call.resolve()
        }
    }

    /// Opens Game Center's own board UI. `shown: false` means the player is not
    /// signed in - not an error; the game says so and moves on. We do not
    /// re-present the sign-in sheet here, since `authenticateHandler` already
    /// offered it at launch and a second prompt would only repeat a refusal.
    @objc func showLeaderboard(_ call: CAPPluginCall) {
        guard let identifier = call.getString("leaderboardId") else {
            call.reject("leaderboardId is required")
            return
        }
        guard GKLocalPlayer.local.isAuthenticated else {
            call.resolve(["shown": false])
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self, let host = self.bridge?.viewController else {
                call.resolve(["shown": false])
                return
            }
            let controller = GKGameCenterViewController(
                leaderboardID: identifier,
                playerScope: .global,
                timeScope: .allTime
            )
            controller.gameCenterDelegate = self
            host.present(controller, animated: true)
            call.resolve(["shown": true])
        }
    }
}

extension CloudSavePlugin: GKGameCenterControllerDelegate {
    public func gameCenterViewControllerDidFinish(_ gameCenterViewController: GKGameCenterViewController) {
        gameCenterViewController.dismiss(animated: true)
    }
}
