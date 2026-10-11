import AuthenticationServices
import Foundation
import UIKit

/// The RECOVERY key ceremony. The recovery provider checks WebAuthn against the web app's origin, so the
/// app opens the web page `/native/recovery-key` in an `ASWebAuthenticationSession`; the page runs the
/// security key or passkey ceremony and answers at `sqwallet://recovery-key#state=…&response=…`.
final class RecoveryKeySession: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum Mode: String {
        case register, authenticate
    }

    private var session: ASWebAuthenticationSession?

    /// Returns the WebAuthn response (JSON object) for the provider, unchanged.
    func run(_ mode: Mode, options: Any) async throws -> Any {
        let state = UUID().uuidString
        let optionsJson = try JSONSerialization.data(withJSONObject: options)
        var fragment = URLComponents()
        fragment.queryItems = [
            URLQueryItem(name: "mode", value: mode.rawValue),
            URLQueryItem(name: "options", value: Base64URL.encode(optionsJson)),
            URLQueryItem(name: "state", value: state),
        ]
        var page = URLComponents(url: AppConfig.webURL.appending(path: "native/recovery-key"), resolvingAgainstBaseURL: false)!
        page.fragment = fragment.percentEncodedQuery

        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: page.url!, callback: .customScheme(AppConfig.callbackScheme)) { url, error in
                if let url { continuation.resume(returning: url) }
                else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    continuation.resume(throwing: NativeError("cancelled"))
                } else {
                    continuation.resume(throwing: NativeError(error?.localizedDescription ?? "The recovery key page did not answer."))
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = true
            self.session = session
            if !session.start() { continuation.resume(throwing: NativeError("The recovery key page could not be opened.")) }
        }
        session = nil

        var answer = URLComponents()
        answer.percentEncodedQuery = callback.fragment
        let items = Dictionary((answer.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { _, last in last })
        guard items["state"] == state else { throw NativeError("The recovery key answer did not match this request.") }
        if let error = items["error"] { throw NativeError(error) }
        guard let response = items["response"].flatMap(Base64URL.decode) else { throw NativeError("The recovery key page gave no answer.") }
        return try JSONSerialization.jsonObject(with: response)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
}

enum Base64URL {
    static func encode(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func decode(_ text: String) -> Data? {
        var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        return Data(base64Encoded: base64)
    }
}
