import Combine
import CryptoSwift
import Foundation
import Observation
@preconcurrency import ReownWalletKit
import Security
@preconcurrency import WalletConnectSign

/// WalletConnect's session (the app has its own `Session`: the Mock login and the safe).
typealias WCSession = WalletConnectSign.Session

/// WalletConnect with Reown's Swift SDK (WalletKit 2.4.0): websites such as app.aave.com connect to the
/// wallet by QR code or link. As in the web app (apps/web/lib/walletconnect.ts):
///
/// - Sessions: Base Sepolia only, for the client's USDC account.
/// - Requests: `eth_sendTransaction` only. The wallet core prepares each one as an operation signed with the
///   MPC key, after Swissquote decodes and checks it; the client confirms with Face ID. Message signing is
///   refused in this prototype.
/// - The website gets the real transaction hash, or an error that says why.
@Observable
final class WalletConnectService {
    static let baseSepolia = "eip155:84532"

    /// A connection to approve or a transaction to confirm, shown over any screen.
    enum Pending: Identifiable {
        case connect(WCSession.Proposal, VerifyContext?)
        case request(Request, VerifyContext?)

        var id: String {
            switch self {
            case .connect(let proposal, _): "connect-\(proposal.id)"
            case .request(let request, _): "request-\(request.id)"
            }
        }
    }

    private(set) var queue: [Pending] = []
    private(set) var sessions: [WCSession] = []
    /// Why WalletConnect cannot run (no project ID), shown where it would be used.
    private(set) var unavailable: String?

    @ObservationIgnored private var started = false
    @ObservationIgnored private var subscriptions = Set<AnyCancellable>()

    /// The Reown project ID (public by design), from the build setting SQW_REOWN_PROJECT_ID.
    private static var projectId: String? {
        let value = Bundle.main.object(forInfoDictionaryKey: "SQWReownProjectID") as? String ?? ""
        return value.isEmpty || value.hasPrefix("$(") ? nil : value
    }

    func start() {
        guard !started else { return }
        started = true
        guard let projectId = Self.projectId else {
            unavailable = "WalletConnect is not set up: the Reown project ID is missing (NEXT_PUBLIC_REOWN_PROJECT_ID in .env)."
            return
        }
        Networking.configure(groupIdentifier: Self.ownKeychainGroup(), projectId: projectId, socketFactory: URLSessionSocketFactory())
        let redirect = try? AppMetadata.Redirect(native: "\(AppConfig.callbackScheme)://", universal: nil)
        WalletKit.configure(
            metadata: AppMetadata(
                name: "Swissquote Wallet (prototype)",
                description: "Self-custody wallet prototype, protected by Swissquote",
                url: AppConfig.webURL.absoluteString,
                icons: [AppConfig.webURL.appending(path: "swissquote-logo.png").absoluteString],
                redirect: redirect!),
            crypto: CryptoSwiftProvider())

        WalletKit.instance.sessionProposalPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] proposal, context in self?.queue.append(.connect(proposal, context)) }
            .store(in: &subscriptions)
        WalletKit.instance.sessionRequestPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] request, context in self?.queue.append(.request(request, context)) }
            .store(in: &subscriptions)
        WalletKit.instance.sessionsPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] sessions in self?.sessions = sessions }
            .store(in: &subscriptions)
        sessions = WalletKit.instance.getSessions()
    }

    /// The card on top has been dealt with.
    func next() {
        if !queue.isEmpty { queue.removeFirst() }
    }

    // MARK: - Connecting

    /// A WalletConnect link, from a QR code or copied from the website.
    static func isPairingLink(_ text: String) -> Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).range(of: #"^wc:[0-9a-f]+@2\?"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    func pair(_ link: String) async throws {
        start()
        if let unavailable { throw NativeError(unavailable) }
        guard let uri = WalletConnectURI(string: link.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            throw NativeError("This is not a WalletConnect link.")
        }
        try await WalletKit.instance.pair(uri: uri)
    }

    /// Whether the website offers Base Sepolia, the only network this wallet works on.
    static func offersBaseSepolia(_ proposal: WCSession.Proposal) -> Bool {
        let namespaces = [proposal.requiredNamespaces, proposal.optionalNamespaces ?? [:]]
        return namespaces.contains { group in
            group.contains { key, namespace in
                key == baseSepolia || (key == "eip155" && (namespace.chains ?? []).contains { $0.absoluteString == baseSepolia })
            }
        }
    }

    func approve(_ proposal: WCSession.Proposal, account address: String) async throws {
        guard let chain = Blockchain(Self.baseSepolia), let account = Account(blockchain: chain, address: address) else {
            throw NativeError("Your USDC account address is not valid.")
        }
        // Advertised so websites accept the wallet; only eth_sendTransaction is carried out.
        let namespaces = ["eip155": SessionNamespace(
            chains: [chain], accounts: [account],
            methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"],
            events: ["accountsChanged", "chainChanged"])]
        try await WalletKit.instance.approve(proposalId: proposal.id, namespaces: namespaces)
    }

    func reject(_ proposal: WCSession.Proposal) async throws {
        try await WalletKit.instance.rejectSession(proposalId: proposal.id, reason: .userRejected)
    }

    func disconnect(_ session: WCSession) async throws {
        try await WalletKit.instance.disconnect(topic: session.topic)
        sessions = WalletKit.instance.getSessions()
    }

    // MARK: - Requests

    /// The app a request comes from.
    func peer(of request: Request) -> AppMetadata? {
        sessions.first { $0.topic == request.topic }?.peer
    }

    /// The transaction a website asked for, checked for shape before anything else.
    static func transaction(of request: Request) throws -> (to: String, data: String, value: String) {
        guard request.method == "eth_sendTransaction" else {
            throw NativeError("This wallet only carries out transactions for apps, not message signatures.")
        }
        guard request.chainId.absoluteString == baseSepolia else { throw NativeError("This wallet only works on Base Sepolia.") }
        struct Transaction: Codable {
            let to: String?
            let data: String?
            let input: String?
            let value: String?
        }
        guard let tx = try? request.params.get([Transaction].self).first, let to = tx.to,
              to.range(of: "^0x[0-9a-fA-F]{40}$", options: .regularExpression) != nil else {
            throw NativeError("The app sent a transaction this wallet cannot read.")
        }
        let data = tx.data ?? tx.input ?? "0x"
        guard data.range(of: "^0x[0-9a-fA-F]*$", options: .regularExpression) != nil else {
            throw NativeError("The app sent a transaction this wallet cannot read.")
        }
        // The core takes the value as a decimal string; websites send it as hex. The core refuses any ETH value,
        // so an amount too large to read here is refused too, never read as zero.
        var value = "0"
        if let raw = tx.value {
            let amount: UInt64? = raw.hasPrefix("0x") ? (raw.count == 2 ? 0 : UInt64(raw.dropFirst(2), radix: 16)) : UInt64(raw)
            guard let amount else {
                throw NativeError("The app asked to send ETH directly. In the app, choose WETH instead of ETH.")
            }
            value = String(amount)
        }
        return (to, data, value)
    }

    func respond(_ request: Request, hash: String) async throws {
        try await WalletKit.instance.respond(topic: request.topic, requestId: request.id, response: .response(AnyCodable(hash)))
    }

    func respond(_ request: Request, error: String) async {
        try? await WalletKit.instance.respond(topic: request.topic, requestId: request.id,
                                              response: .error(JSONRPCError(code: 5000, message: error)))
    }

    // MARK: -

    /// The app's own default Keychain access group ("TEAMID.bundle-id"). WalletKit keeps its keys under a
    /// "group identifier"; a free Apple account has no App Groups, but every app may use its own group.
    private static func ownKeychainGroup() -> String {
        let probe: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: "ch.swissquote.wallet.group-probe",
                                      kSecAttrAccount: "probe", kSecReturnAttributes: true]
        var result: AnyObject?
        var status = SecItemCopyMatching(probe as CFDictionary, &result)
        if status == errSecItemNotFound {
            var add = probe
            add[kSecValueData] = Data()
            add[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(add as CFDictionary, &result)
        }
        let group = (result as? [CFString: Any])?[kSecAttrAccessGroup] as? String
        return group ?? (Bundle.main.bundleIdentifier ?? "ch.swissquote.wallet.prototype")
    }
}

/// Keccak-256 from CryptoSwift. Public-key recovery is only needed for "Sign in with Ethereum", which this
/// prototype refuses, so it says so rather than guessing.
nonisolated struct CryptoSwiftProvider: CryptoProvider {
    func recoverPubKey(signature: EthereumSignature, message: Data) throws -> Data {
        throw NativeError("Sign in with Ethereum is not supported by this wallet.")
    }

    func keccak256(_ data: Data) -> Data {
        Data(SHA3(variant: .keccak256).calculate(for: [UInt8](data)))
    }
}

/// WalletKit's relay socket on Apple's own WebSocket (URLSessionWebSocketTask).
nonisolated struct URLSessionSocketFactory: WebSocketFactory {
    func create(with url: URL) -> WebSocketConnecting { URLSessionSocket(url: url) }
}

nonisolated final class URLSessionSocket: NSObject, WebSocketConnecting, URLSessionWebSocketDelegate, @unchecked Sendable {
    var isConnected = false
    var onConnect: (() -> Void)?
    var onDisconnect: ((Error?) -> Void)?
    var onText: ((String) -> Void)?
    var request: URLRequest

    private var session: URLSession?
    private var task: URLSessionWebSocketTask?

    init(url: URL) {
        request = URLRequest(url: url)
    }

    func connect() {
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        let task = session.webSocketTask(with: request)
        self.session = session
        self.task = task
        task.resume()
        receive(on: task)
    }

    func disconnect() {
        task?.cancel(with: .normalClosure, reason: nil)
    }

    func write(string: String, completion: (() -> Void)?) {
        task?.send(.string(string)) { _ in completion?() }
    }

    private func receive(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self, task === self.task else { return }
            switch result {
            case .success(.string(let text)):
                onText?(text)
                receive(on: task)
            case .success(.data(let data)):
                onText?(String(decoding: data, as: UTF8.self))
                receive(on: task)
            case .success:
                receive(on: task)
            case .failure(let error):
                closed(error)
            }
        }
    }

    private func closed(_ error: Error?) {
        guard isConnected || task != nil else { return }
        isConnected = false
        task = nil
        session?.finishTasksAndInvalidate()
        session = nil
        onDisconnect?(error)
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        isConnected = true
        onConnect?()
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        closed(nil)
    }
}
