@preconcurrency import ReownWalletKit
import SwiftUI

/// Approval cards for connected apps (apps/web/components/connect-overlay.tsx): a connection request or an
/// app's transaction appears over whatever screen is open, with Swissquote's check, and waits for the client.
struct ConnectOverlay: View {
    let profile: WalletProfile
    @Environment(WalletConnectService.self) private var walletConnect

    var body: some View {
        Color.clear
            .sheet(item: Binding(get: { walletConnect.queue.first }, set: { if $0 == nil { walletConnect.next() } })) { pending in
                NavigationStack {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            switch pending {
                            case .connect(let proposal, let context):
                                ConnectCard(profile: profile, proposal: proposal, context: context)
                            case .request(let request, let context):
                                RequestCard(request: request, context: context)
                            }
                        }
                        .padding(Theme.gutter)
                    }
                    .background(Theme.paper)
                }
                .interactiveDismissDisabled()
                .id(pending.id)
            }
    }
}

/// Who is asking: name, website, and WalletConnect's verification of the website.
private struct AppIdentity: View {
    let name: String
    let url: String
    var icon: String?
    let validation: VerifyContext.ValidationStatus?

    var body: some View {
        HStack(spacing: 12) {
            if let icon, let iconURL = URL(string: icon) {
                AsyncImage(url: iconURL) { $0.resizable().scaledToFit() } placeholder: { Theme.surfaceAlt }
                    .frame(width: 48, height: 48).clipShape(.rect(cornerRadius: 12))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.system(size: 18, weight: .semibold))
                Text(url.replacing(/^https?:\/\//, with: "")).smallMuted()
                if validation == .valid { Text("Website verified by WalletConnect").font(Theme.Text.s).foregroundStyle(Theme.protect) }
                if validation == .invalid {
                    Text("This website does not match the app it claims to be").font(Theme.Text.s).foregroundStyle(Theme.danger)
                }
            }
        }
    }
}

private struct ConnectCard: View {
    let profile: WalletProfile
    let proposal: WCSession.Proposal
    let context: VerifyContext?

    @Environment(WalletConnectService.self) private var walletConnect
    @Environment(WalletCore.self) private var core
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        let peer = proposal.proposer
        let scam = context?.validation == .scam
        let usable = WalletConnectService.offersBaseSepolia(proposal)
        Text("Connect this app?").titleStyle()
        AppIdentity(name: peer.name, url: peer.url, icon: peer.icons.first, validation: context?.validation)
        if scam {
            Notice(.error, "WalletConnect reports this website as a scam. Do not connect it.")
        } else if !usable {
            Notice(.warn, "\(peer.name) does not offer Base Sepolia, the test network this wallet uses, so it cannot connect. To exchange USDC and ETH, use Uniswap from Explore in this app.")
        } else {
            Text("The app will see your USDC account on Base. It can only ask: every transaction it asks for is checked by Swissquote and needs your Face ID.")
                .smallMuted()
        }
        if let error { Notice(.error, error) }
        if usable && !scam {
            Button(busy ? "Connecting…" : "Connect") { act(approve: true) }.buttonStyle(.primary).disabled(busy)
        }
        Button(usable && !scam ? "Don’t connect" : "Close") { act(approve: false) }.buttonStyle(.secondary).disabled(busy)
    }

    private func act(approve: Bool) {
        Task {
            busy = true
            error = nil
            do {
                if approve {
                    guard let address = try await core.call("usdcAccount")["address"].string else { throw NativeError("No USDC account.") }
                    try await walletConnect.approve(proposal, account: address)
                } else {
                    try await walletConnect.reject(proposal)
                }
                walletConnect.next()
            } catch {
                self.error = error.localizedDescription
                busy = false
            }
        }
    }
}

private struct RequestCard: View {
    let request: Request
    let context: VerifyContext?

    @Environment(WalletConnectService.self) private var walletConnect
    @Environment(WalletCore.self) private var core
    @State private var prepared: JSONValue?
    @State private var refusal: String?
    @State private var confirmed = false
    @State private var busy = false
    @State private var sent: String?

    var body: some View {
        // Swissquote prepares and checks the request as soon as the card appears, as on the web.
        Group { content }.task { await prepare() }
    }

    @ViewBuilder private var content: some View {
        let peer = walletConnect.peer(of: request)
        let name = peer?.name ?? "An app"
        if let sent {
            Text("Done").titleStyle()
            Notice(.ok) {
                Text("\(name) has its answer: the transaction is confirmed on Base.")
                ExplorerLink(label: "View \(Format.shortId(sent)) on Base", url: Explorer.baseTx(sent))
            }
            Button("Close") { walletConnect.next() }.buttonStyle(.primary)
        } else {
            Text("\(name) asks you to confirm").titleStyle()
            AppIdentity(name: name, url: peer?.url ?? "", validation: context?.validation)
            if prepared == nil && refusal == nil { Text("Swissquote is checking the request…").leadStyle() }
            if let refusal { Notice(.error, refusal) }
            let review = prepared?["review"]
            if let review, !review.isNull {
                let blocked = review["verdict"].string == "BLOCKED"
                Notice(blocked ? .error : .warn) {
                    Label(blocked ? "Stopped by Swissquote" : "Checked by Swissquote", systemImage: "checkmark.shield.fill")
                        .font(.system(size: 18, weight: .semibold))
                    ForEach(review["reasons"].array.compactMap(\.string), id: \.self) { Text($0) }
                    if let chf = review["valueChf"].number, chf > 0 { Text("About \(Format.chf(chf))").font(Theme.Text.s) }
                }
            }
            if prepared != nil, review?["verdict"].string != "BLOCKED", refusal == nil {
                Text("Network fee: paid by Swissquote.").smallMuted()
                if !confirmed {
                    Button("Yes, I want to do this") { confirmed = true }.buttonStyle(.primary)
                } else {
                    Button { Task { await confirm() } } label: { Label(busy ? "Sending…" : "Confirm with Face ID", systemImage: "faceid") }
                        .buttonStyle(.primary).disabled(busy)
                }
            }
            Button(refusal == nil ? "Decline" : "Close") {
                Task {
                    await walletConnect.respond(request, error: refusal ?? "The client declined.")
                    if let handle = prepared?["handle"].string { _ = try? await core.call("release", handle) }
                    walletConnect.next()
                }
            }
            .buttonStyle(.secondary).disabled(busy)
        }
    }

    private func prepare() async {
        do {
            let tx = try WalletConnectService.transaction(of: request)
            prepared = try await core.call("prepareDappTransaction", JSONValue.object(["to": .string(tx.to), "data": .string(tx.data), "value": .string(tx.value)]))
        } catch {
            refusal = error.localizedDescription
        }
    }

    private func confirm() async {
        guard let handle = prepared?["handle"].string else { return }
        busy = true
        defer { busy = false }
        do {
            let result = try await core.call("sendDappTransaction", handle)
            guard let hash = result["txHash"].string else { throw NativeError("Base gave no transaction.") }
            try await walletConnect.respond(request, hash: hash)
            sent = hash
        } catch {
            refusal = error.localizedDescription == "cancelled" ? "Face ID was cancelled. Nothing was sent." : error.localizedDescription
            await walletConnect.respond(request, error: refusal ?? "The transaction failed.")
        }
    }
}
