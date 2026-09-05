import Foundation
import Capacitor
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
}
