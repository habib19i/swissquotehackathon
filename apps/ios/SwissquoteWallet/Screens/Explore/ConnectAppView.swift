@preconcurrency import ReownWalletKit
import SwiftUI
import VisionKit

/// Connect a website with WalletConnect (apps/web/app/explore/scan): scan its QR code with the camera, or
/// paste its link; then the connection card appears. Lists the connected apps, with Disconnect.
struct ConnectAppView: View {
    let profile: WalletProfile

    @Environment(WalletConnectService.self) private var walletConnect
    @State private var link = ""
    @State private var scanning = false
    @State private var busy = false
    @State private var message: (ok: Bool, text: String)?

    private var cameraAvailable: Bool { DataScannerViewController.isSupported && DataScannerViewController.isAvailable }

    var body: some View {
        Screen {
            Text("Connect an app").titleStyle()
            Text("On the app’s website, choose WalletConnect. Scan the QR code it shows, or copy its link and paste it here.").leadStyle()
            if let unavailable = walletConnect.unavailable { Notice(.warn, unavailable) }
            if cameraAvailable {
                Button { scanning = true } label: { Label("Scan the QR code", systemImage: "qrcode.viewfinder") }
                    .buttonStyle(.primary)
            }
            LabeledField(label: "Or paste the link", text: $link, placeholder: "wc:…", monospaced: true)
            Button(busy ? "Connecting…" : "Connect") { connect(link) }
                .buttonStyle(.secondary)
                .disabled(busy || !WalletConnectService.isPairingLink(link))
            if let message { Notice(message.ok ? .ok : .error, message.text) }

            Text("Connected apps").font(Theme.Text.l).padding(.top, 8)
            if walletConnect.sessions.isEmpty { Text("None yet.").smallMuted() }
            ForEach(walletConnect.sessions, id: \.topic) { session in
                RowCard(title: session.peer.name, subtitle: session.peer.url.replacing(/^https?:\/\//, with: "")) {
                    EmptyView()
                } trailing: {
                    Button("Disconnect") { Task { try? await walletConnect.disconnect(session) } }
                        .font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.brandText)
                }
            }
            Text("Each transaction an app asks for is checked by Swissquote and needs your Face ID. Message signatures are refused.")
                .smallMuted()
        }
        .onAppear { walletConnect.start() }
        .sheet(isPresented: $scanning) {
            QRScanner { code in
                scanning = false
                link = code
                connect(code)
            }
            .ignoresSafeArea()
        }
    }

    private func connect(_ text: String) {
        guard WalletConnectService.isPairingLink(text) else {
            message = (false, "This is not a WalletConnect code. On the website, choose WalletConnect, then scan its QR code.")
            return
        }
        Task {
            busy = true
            message = nil
            defer { busy = false }
            do {
                try await walletConnect.pair(text)
                message = (true, "Connecting… the app’s request appears in a moment.")
                link = ""
            } catch {
                message = (false, error.localizedDescription)
            }
        }
    }
}

/// The camera, reading QR codes (VisionKit's data scanner); calls back once with the first code.
private struct QRScanner: UIViewControllerRepresentable {
    let onCode: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        private let onCode: (String) -> Void
        private var done = false

        init(onCode: @escaping (String) -> Void) { self.onCode = onCode }

        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            for case .barcode(let code) in items {
                guard !done, let text = code.payloadStringValue else { continue }
                done = true
                scanner.stopScanning()
                onCode(text)
            }
        }
    }
}
