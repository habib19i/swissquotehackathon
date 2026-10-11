import Foundation

/// Where the app finds the services on the Mac. One setting: `SQW_SERVER_HOST` in the build settings
/// (Info.plist `SQWServerHost`). The Simulator shares the Mac's network, so `localhost` works there; a
/// device needs the Mac's address (and an https name for the recovery key, see docs/ios-plan.md).
enum AppConfig {
    static let serverHost: String = {
        let value = Bundle.main.object(forInfoDictionaryKey: "SQWServerHost") as? String ?? ""
        return value.isEmpty || value.hasPrefix("$(") ? "localhost" : value
    }()

    static let cosignerURL = URL(string: "http://\(serverHost):4001/")!
    static let recoveryURL = URL(string: "http://\(serverHost):4002/")!
    /// The Next.js server: `/api/assistant`, `/api/price`, the recovery-key page, the Mock e-banking page.
    static let webURL = URL(string: "http://\(serverHost):3000/")!

    /// The wallet core's page, served from the app bundle by `CoreSchemeHandler`.
    static let coreScheme = "sqw"
    static let coreURL = URL(string: "sqw://core/index.html")!
    /// Where the recovery-key web page sends its answer back (`ASWebAuthenticationSession`).
    static let callbackScheme = "sqwallet"
}
