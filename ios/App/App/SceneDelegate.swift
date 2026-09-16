import UIKit
import Capacitor
import AppTrackingTransparency
import UserMessagingPlatform

class TrackingBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(TrackingPermissionPlugin())
    }
}

@objc(TrackingPermissionPlugin)
class TrackingPermissionPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "TrackingPermissionPlugin"
    let jsName = "TrackingPermission"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showConsentForm", returnType: CAPPluginReturnPromise)
    ]
    private var requesting = false

    @objc func showConsentForm(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let controller = self.bridge?.viewController else {
                call.reject("No consent presentation controller")
                return
            }
            // AdMob's consent presenter is only wired by initialize(), which
            // also starts Mobile Ads. Present UMP directly to keep consent first.
            ConsentForm.loadAndPresentIfRequired(from: controller) { error in
                if let error = error {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve(["canRequestAds": ConsentInformation.shared.canRequestAds])
                }
            }
        }
    }

    @objc func request(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard !self.requesting else {
                call.reject("Tracking permission request already in progress")
                return
            }
            self.requesting = true
            self.requestWhenActive(call, attemptsLeft: 120)
        }
    }

    private func requestWhenActive(_ call: CAPPluginCall, attemptsLeft: Int) {
        let status = ATTrackingManager.trackingAuthorizationStatus
        guard status == .notDetermined else {
            requesting = false
            call.resolve(["status": status == .authorized ? "authorized" :
                status == .restricted ? "restricted" : "denied"])
            return
        }
        guard attemptsLeft > 0 else {
            requesting = false
            call.reject("Tracking permission remains undetermined; ads disabled")
            return
        }
        guard UIApplication.shared.applicationState == .active,
              bridge?.viewController?.view.window?.windowScene?.activationState == .foregroundActive,
              bridge?.viewController?.presentedViewController == nil else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                self.requestWhenActive(call, attemptsLeft: attemptsLeft - 1)
            }
            return
        }
        ATTrackingManager.requestTrackingAuthorization { _ in
            // Read the actual status again. A suppressed request can complete
            // without showing a prompt; it must not open the ad startup gate.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                self.requestWhenActive(call, attemptsLeft: attemptsLeft - 1)
            }
        }
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = TrackingBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
