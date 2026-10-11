import SwiftUI
import WebKit

@main
struct SwissquoteWalletApp: App {
    @State private var core: WalletCore
    @State private var session: Session
    @State private var walletConnect = WalletConnectService()

    init() {
        AppConfig.rememberLaunchArgument()
        // UI tests start from a fresh phone: no login, no safe, no Face ID key.
        if ProcessInfo.processInfo.arguments.contains("-freshPhone") {
            Storage().deleteAll()
            Vault.deleteAll()
            FaceIdKey.deleteAll()
        }
        let core = WalletCore()
        _core = State(initialValue: core)
        _session = State(initialValue: Session(core: core))
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                // The wallet core's web view stays in the window (WebKit pauses web views that are not),
                // one point wide and invisible: every screen is drawn natively.
                CoreWebView(webView: core.webView)
                    .frame(width: 1, height: 1)
                    .opacity(0.01)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                if ProcessInfo.processInfo.arguments.contains("-bridgeCheck") {
                    BridgeCheckView()
                } else {
                    RootView()
                }
            }
            .environment(core)
            .environment(session)
            .environment(walletConnect)
            .task { await session.reload() }
            .task { await session.followPrice() }
        }
    }
}

private struct CoreWebView: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
