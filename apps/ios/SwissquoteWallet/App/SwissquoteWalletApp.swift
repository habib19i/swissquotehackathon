import SwiftUI
import WebKit

@main
struct SwissquoteWalletApp: App {
    @State private var core = WalletCore()

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
                BridgeCheckView()
            }
            .environment(core)
            .background(Theme.paper)
        }
    }
}

private struct CoreWebView: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
