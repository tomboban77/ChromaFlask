// swift-tools-version: 5.9
import PackageDescription

// Capacitor 8 apps use Swift Package Manager; the product name must be the
// PascalCase of the npm package name (`capacitor-cloudsave`), which is what
// `npx cap sync` writes into ios/App/CapApp-SPM/Package.swift.
let package = Package(
    name: "CapacitorCloudsave",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapacitorCloudsave",
            targets: ["CloudSavePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "CloudSavePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Plugin")
    ]
)
