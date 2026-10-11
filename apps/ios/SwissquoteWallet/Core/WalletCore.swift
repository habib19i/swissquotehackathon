import Foundation
import Observation
import OSLog
import WebKit

/// The wallet core: the web app's own wallet layer and crypto (DKLs23, bitcoinjs-lib, viem, `@sqw/*`),
/// running unchanged in a hidden `WKWebView` (built by `apps/ios-core`). Screens call it by name:
///
///     let profile: JSONValue = try await core.call("profile.load")
///
/// Calls go to `window.sqwCore.call(method, argsJson)`; the core calls back for Face ID, the Keychain
/// vault and storage (`NativeBridge`), and reports progress as one-way events.
@Observable
final class WalletCore {
    enum State: Equatable {
        case loading
        case ready(methods: [String])
        case failed(String)
    }

    private(set) var state = State.loading
    /// Last progress event of a key generation or recovery: `(event, round, total)`.
    private(set) var progress: (event: String, round: Int, total: Int)?

    @ObservationIgnored let webView: WKWebView
    @ObservationIgnored private let native: NativeBridge
    @ObservationIgnored private var loaded: [CheckedContinuation<Void, any Error>] = []

    init(native: NativeBridge = NativeBridge()) {
        self.native = native
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(CoreSchemeHandler(), forURLScheme: AppConfig.coreScheme)
        configuration.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: configuration)
        #if DEBUG
        webView.isInspectable = true
        #endif
        let messages = MessageRelay()
        configuration.userContentController.add(messages, name: "native")
        messages.core = self
        start()
    }

    /// Loads (or reloads) the core page and waits until `window.sqwCore` is there.
    func start() {
        state = .loading
        webView.load(URLRequest(url: AppConfig.coreURL))
        Task {
            for _ in 0..<100 {
                try? await Task.sleep(for: .milliseconds(100))
                if let names = try? await webView.callAsyncJavaScript(
                    "return window.sqwCore ? window.sqwCore.methods : null", contentWorld: .page) as? [String] {
                    state = .ready(methods: names)
                    loaded.forEach { $0.resume() }
                    loaded = []
                    return
                }
            }
            let reason = "The wallet core did not start. Is it in the app bundle (pnpm --filter @sqw/ios-core build)?"
            state = .failed(reason)
            loaded.forEach { $0.resume(throwing: CoreError(name: "CoreNotLoaded", message: reason)) }
            loaded = []
        }
    }

    /// Waits for the core to be loaded.
    func ready() async throws {
        switch state {
        case .ready: return
        case .failed(let reason): throw CoreError(name: "CoreNotLoaded", message: reason)
        case .loading: try await withCheckedThrowingContinuation { loaded.append($0) }
        }
    }

    // MARK: - Calls into the core

    /// Calls a core method with JSON-encodable arguments and decodes its answer as `T`.
    func call<T: Decodable>(_ method: String, _ args: any Encodable..., as type: T.Type) async throws -> T {
        let answer = try JSONDecoder().decode(Answer<T>.self, from: try await invoke(method, args))
        if answer.ok, let value = answer.value { return value }
        // `null` is a valid answer when T is optional (no client, no safe on this phone).
        if answer.ok, let none = try? JSONDecoder().decode(T.self, from: Data("null".utf8)) { return none }
        throw answer.error ?? CoreError(name: "BadAnswer", message: "The wallet core gave an empty answer to \(method).")
    }

    /// Calls a core method and returns its answer as plain JSON (`.null` for none).
    @discardableResult
    func call(_ method: String, _ args: any Encodable...) async throws -> JSONValue {
        let answer = try JSONDecoder().decode(Answer<JSONValue>.self, from: try await invoke(method, args))
        if answer.ok { return answer.value ?? .null }
        throw answer.error ?? CoreError(name: "BadAnswer", message: "The wallet core gave an empty answer to \(method).")
    }

    /// WebCrypto (`crypto.subtle`, `randomUUID`) needs a secure context: true when `sqw://` is treated as one.
    func isSecureContext() async -> Bool {
        (try? await webView.callAsyncJavaScript("return window.isSecureContext", contentWorld: .page) as? Bool) ?? false
    }

    private func invoke(_ method: String, _ args: [any Encodable]) async throws -> Data {
        try await ready()
        let argsJson = String(decoding: try JSONEncoder().encode(args.map(AnyEncodable.init)), as: UTF8.self)
        let raw = try await webView.callAsyncJavaScript(
            "return await window.sqwCore.call(method, args)",
            arguments: ["method": method, "args": argsJson],
            contentWorld: .page)
        guard let json = raw as? String else { throw CoreError(name: "BadAnswer", message: "The wallet core gave no answer to \(method).") }
        return Data(json.utf8)
    }

    private struct Answer<T: Decodable>: Decodable {
        let ok: Bool
        let value: T?
        let error: CoreError?
    }

    // MARK: - Calls from the core

    fileprivate func received(_ body: Any) {
        guard let message = body as? [String: Any] else { return }
        if let event = message["event"] as? String {
            let data = message["data"] as? [String: Any]
            progress = (event, data?["round"] as? Int ?? 0, data?["total"] as? Int ?? 0)
            return
        }
        guard let id = message["id"] as? Int, let method = message["method"] as? String else { return }
        let params = message["params"] as? [String: Any] ?? [:]
        Self.log.info("\(method, privacy: .public)")
        Task {
            do {
                let value = try await native.handle(method, params)
                await reply(id, ok: true, value)
            } catch {
                Self.log.error("\(method, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
                await reply(id, ok: false, ["message": error.localizedDescription])
            }
        }
    }

    private static let log = Logger(subsystem: "ch.swissquote.wallet.prototype", category: "native")

    private func reply(_ id: Int, ok: Bool, _ value: [String: Any]) async {
        let data = (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8)
        _ = try? await webView.callAsyncJavaScript(
            "window.sqwNative.reply(id, ok, json)",
            arguments: ["id": id, "ok": ok, "json": String(decoding: data, as: UTF8.self)],
            contentWorld: .page)
    }
}

/// Holds the core weakly: the web view's content controller keeps its message handlers alive.
private final class MessageRelay: NSObject, WKScriptMessageHandler {
    weak var core: WalletCore?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        core?.received(message.body)
    }
}

/// An error the core reported, with the fields the screens react to (see apps/ios-core/src/index.ts).
nonisolated struct CoreError: Error, LocalizedError, Decodable, Equatable {
    let name: String
    let message: String
    var status: Int?
    var pocketMax: String?
    var savingsMax: String?
    var available: String?

    init(name: String, message: String) {
        self.name = name
        self.message = message
    }

    var errorDescription: String? { message }
}

private struct AnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: any Encoder) throws { try value.encode(to: encoder) }
}
