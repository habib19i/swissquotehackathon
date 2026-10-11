import Foundation

/// Where the app finds the services on the Mac: one address, the Next.js server, which also forwards
/// `/svc/cosigner/*` and `/svc/recovery/*` to the two key-share holders (as for the web app on a phone).
///
/// - Simulator: `http://localhost:3000` (the build setting `SQW_SERVER_URL`, Info.plist `SQWServerURL`).
/// - iPhone: the Mac's https tunnel, e.g. `https://….trycloudflare.com`. Set it in the Demo panel, or launch
///   once with `-SQWServerURL https://…`; it is remembered. The recovery key needs https and a real name.
nonisolated enum AppConfig {
    private static let key = "SQWServerURL"

    static var serverURL: URL {
        if let saved = UserDefaults.standard.string(forKey: key).flatMap(validURL) { return saved }
        let built = Bundle.main.object(forInfoDictionaryKey: key) as? String ?? ""
        return validURL(built) ?? URL(string: "http://localhost:3000")!
    }

    /// Remembers the server address; nil goes back to the built-in one.
    static func setServerURL(_ text: String?) {
        if let text, let url = validURL(text) { UserDefaults.standard.set(url.absoluteString, forKey: key) }
        else { UserDefaults.standard.removeObject(forKey: key) }
    }

    /// A launch argument `-SQWServerURL …` (Xcode scheme or devicectl) is kept for later launches.
    static func rememberLaunchArgument() {
        let arguments = ProcessInfo.processInfo.arguments
        if let index = arguments.firstIndex(of: "-\(key)"), arguments.indices.contains(index + 1) {
            setServerURL(arguments[index + 1])
        }
    }

    static func validURL(_ text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !trimmed.hasPrefix("$("), let url = URL(string: trimmed),
              ["http", "https"].contains(url.scheme ?? ""), url.host() != nil else { return nil }
        return url
    }

    static var cosignerURL: URL { serverURL.appending(path: "svc/cosigner/") }
    static var recoveryURL: URL { serverURL.appending(path: "svc/recovery/") }
    /// The Next.js server: `/api/assistant`, `/api/price`, the recovery-key page, the Mock e-banking page.
    static var webURL: URL { serverURL }
    static var serverName: String { serverURL.host() ?? serverURL.absoluteString }

    /// The wallet core's page, served from the app bundle by `CoreSchemeHandler`.
    static let coreScheme = "sqw"
    static let coreURL = URL(string: "sqw://core/index.html")!
    /// Where the recovery-key web page sends its answer back (`ASWebAuthenticationSession`).
    static let callbackScheme = "sqwallet"
}
