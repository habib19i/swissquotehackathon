import CoreImage.CIFilterBuiltins
import SwiftUI

/// Receive (screen 5): a QR code for the chosen pocket, and "Transfer from my Swissquote account" (Mock:
/// a demo Swissquote account holding real test coins). Mirrors apps/web/app/receive/page.tsx.
struct ReceiveView: View {
    let profile: WalletProfile

    private enum Target: String, CaseIterable {
        case savings, pocket, usdc

        var place: String {
            switch self {
            case .savings: "Savings safe"
            case .pocket: "Spending pocket"
            case .usdc: "USDC"
            }
        }

        var explained: String {
            switch self {
            case .savings: "For larger amounts. Moving them out needs your Face ID and Swissquote's check."
            case .pocket: "For everyday payments with Face ID only. Keep about CHF 100 here."
            case .usdc: "USDC on the Base network. Face ID pays your contacts within your daily limit."
            }
        }

        /// The faucet gives the demo account small amounts of test USDC, so USDC transfers are smaller.
        var transferAmountsChf: [Double] { self == .usdc ? [5, 10, 15] : [50, 100, 200] }
    }

    @Environment(WalletCore.self) private var core
    @State private var target = Target.savings
    @State private var usdcAddress: String?
    @State private var usdcError: String?
    @State private var choosing = false
    @State private var copied = false
    @State private var busy = false
    @State private var result: (ok: Bool, text: String, link: (label: String, url: URL)?)?

    private var address: String? {
        switch target {
        case .savings: profile.savingsAddress
        case .pocket: profile.pocketAddress
        case .usdc: usdcAddress
        }
    }

    var body: some View {
        Screen {
            Text("Receive").titleStyle()
            Picker("Where should the money go?", selection: $target) {
                ForEach(Target.allCases, id: \.self) { Text($0.place).tag($0) }
            }
            .pickerStyle(.segmented)
            .onChange(of: target) { copied = false }
            Text(target.explained).leadStyle()
            if target == .usdc, let usdcError { Notice(.error, usdcError) }
            if let result {
                Notice(result.ok ? .ok : .error) {
                    Text(result.text)
                    if let link = result.link { ExplorerLink(label: link.label, url: link.url) }
                }
            }
            if let address {
                QRCodeView(text: target == .usdc ? "ethereum:\(address)@84532" : "bitcoin:\(address)")
                    .accessibilityLabel("QR code of your \(target.place) address")
                Text(address)
                    .font(.system(size: 16, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
            }
        } actions: {
            if choosing {
                Text("How much should Swissquote send to your \(target.place)?").foregroundStyle(Theme.inkSoft)
                HStack(spacing: 8) {
                    ForEach(target.transferAmountsChf, id: \.self) { chf in
                        Button(Format.chf(chf)) { Task { await transfer(chf) } }
                            .buttonStyle(.secondary).disabled(busy)
                    }
                }
                Button("Cancel") { choosing = false }.buttonStyle(.quiet).disabled(busy)
            } else {
                Button("Transfer from my Swissquote account") { choosing = true }
                    .buttonStyle(.primary).disabled(address == nil)
                Button(copied ? "Address copied" : "Copy address") {
                    UIPasteboard.general.string = address
                    copied = true
                }
                .buttonStyle(.secondary).disabled(address == nil)
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    MockTag()
                    Text("Transfers come from a demo Swissquote account holding test bitcoin and test USDC.").smallMuted()
                }
            }
        }
        .navigationTitle("")
        .task {
            do { usdcAddress = try await core.call("usdcAccount")["address"].string }
            catch { usdcError = error.localizedDescription }
        }
    }

    private func transfer(_ amountChf: Double) async {
        busy = true
        result = nil
        defer { busy = false }
        do {
            if target == .usdc {
                let hash = try await core.call("cosigner.demoTransferUsdc", profile.walletId, amountChf).string ?? ""
                result = (true, "\(Format.chf(amountChf)) in USDC has arrived.", ("View \(Format.shortId(hash)) on Base", Explorer.baseTx(hash)))
            } else {
                let txid = try await core.call("cosigner.demoTransfer", profile.walletId, amountChf, target.rawValue).string ?? ""
                result = (true, "\(Format.chf(amountChf)) is on its way to your \(target.place). You can use it right away.",
                          ("View \(Format.shortId(txid)) on the Bitcoin network", Explorer.btcTx(txid)))
            }
            choosing = false
        } catch {
            result = (false, error.localizedDescription, nil)
        }
    }
}

/// A black-on-white QR code drawn with Core Image, crisp at any size.
struct QRCodeView: View {
    let text: String

    var body: some View {
        Group {
            if let image = Self.render(text) {
                Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
            } else {
                Color.clear
            }
        }
        .frame(maxWidth: 260, maxHeight: 260)
        .padding(16)
        .background(.white, in: .rect(cornerRadius: Theme.radiusCard))
        .frame(maxWidth: .infinity)
    }

    private static func render(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage,
              let image = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: image)
    }
}
