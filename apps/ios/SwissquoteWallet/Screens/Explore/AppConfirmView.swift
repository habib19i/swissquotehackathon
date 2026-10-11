import SwiftUI

/// A Uniswap or Aave operation prepared by the core (apps/web/lib/wallet-defi.ts `AppUse`), with its handle.
struct AppUse {
    let json: JSONValue
    var handle: String { json["handle"].string ?? "" }
    var request: JSONValue { json["request"] }
    /// "passkey": an approved app, Face ID alone. "mpc": checked and co-signed by Swissquote.
    var signer: String { json["signer"].string ?? "mpc" }
    var review: Review? {
        let review = json["review"]
        guard let verdict = review["verdict"].string else { return nil }
        return Review(verdict: verdict, reasons: review["reasons"].array.compactMap(\.string))
    }
}

/// A vetted app (packages/shared/src/apps.ts).
struct DefiApp: Equatable {
    let id: String
    let name: String
}

/// What goes in and what comes back, in plain language (apps/web/components/app-confirm.tsx).
private func describe(_ use: AppUse, usdcAddress: String?) -> (give: String, get: String) {
    let request = use.request
    if request["app"].string == "uniswap" {
        let fromUsdc = request["tokenIn"].string?.lowercased() == usdcAddress?.lowercased()
        let amountIn = Units(request["amountIn"]), minOut = Units(request["minOut"])
        return (fromUsdc ? Format.usdc(amountIn) : Format.eth(amountIn), "at least \(fromUsdc ? Format.eth(minOut) : Format.usdc(minOut))")
    }
    let amount = request["amount"]
    if request["action"].string == "supply" { return (Format.eth(Units(amount)), "interest, in Aave") }
    // maxUint256: "everything in Aave".
    let all = (amount.string?.count ?? 0) > 70
    return (all ? "all your ETH in Aave" : Format.eth(Units(amount)), "back in your safe")
}

private struct AppSlip: View {
    let app: DefiApp
    let use: AppUse
    @Environment(WalletCore.self) private var core
    @State private var usdcAddress: String?

    var body: some View {
        let (give, get) = describe(use, usdcAddress: usdcAddress)
        Slip {
            Text("With \(app.name)").foregroundStyle(Theme.inkSoft)
            Text(give).font(Theme.Text.amount).monospacedDigit().lineLimit(1).minimumScaleFactor(0.5)
        } details: {
            DetailRow(label: "You get", value: get)
            DetailRow(label: "Goes to", value: "Your own safe")
            DetailRow(label: "Network fee", value: "Paid by Swissquote")
        }
        .task { usdcAddress = try? await core.call("constants")["usdc"].string }
    }
}

/// Confirming an app operation (Explore or the assistant): what goes in, what comes back, Swissquote's
/// check, Face ID.
struct AppConfirmView: View {
    let app: DefiApp
    let use: AppUse
    let onCancel: () -> Void
    let onSent: (String) -> Void

    @Environment(WalletCore.self) private var core
    @State private var sending = false
    @State private var confirmed = false
    @State private var error: (text: String, txHash: String?)?

    var body: some View {
        let review = use.review
        let blocked = review?.verdict == "BLOCKED"
        Screen {
            Text(blocked ? "Stopped" : "Check before you confirm").titleStyle()
            AppSlip(app: app, use: use)
            if use.signer == "passkey" {
                Text("Only your Face ID is needed: \(app.name) is one of your approved apps. Your account on Base checks it itself.").smallMuted()
            }
            if let review { ReviewNotice(review: review) }
            if let error {
                Notice(.error) {
                    Text(error.text)
                    if let hash = error.txHash { ExplorerLink(label: "View \(Format.shortId(hash)) on Base", url: Explorer.baseTx(hash)) }
                }
            }
        } actions: {
            if blocked {
                Button("Back", action: cancel).buttonStyle(.primary)
            } else {
                if review?.verdict == "NEEDS_CONFIRMATION" && !confirmed {
                    Button("Yes, I want to do this") { confirmed = true }.buttonStyle(.primary)
                } else {
                    Button { Task { await confirm() } } label: {
                        FaceIdLabel(sending ? "Sending…" : "Confirm with Face ID")
                    }
                    .buttonStyle(.primary).disabled(sending)
                }
                Button("Cancel", action: cancel).buttonStyle(.secondary).disabled(sending)
            }
        }
    }

    private func cancel() {
        Task { try? await core.call("release", use.handle) }
        onCancel()
    }

    private func confirm() async {
        sending = true
        error = nil
        do {
            let sent = try await core.call("sendAppUse", use.handle, confirmed)
            guard let hash = sent["txHash"].string else { throw CoreError(name: "BadAnswer", message: "Base gave no transaction.") }
            onSent(hash)
        } catch let failure as CoreError {
            error = (failure.message == "cancelled" ? "Face ID was cancelled. Nothing was sent." : failure.message, failure.sentTxHash)
            sending = false
        } catch {
            self.error = (error.localizedDescription, nil)
            sending = false
        }
    }
}

struct AppDoneView: View {
    let app: DefiApp
    let use: AppUse
    let txHash: String
    let onDone: () -> Void

    var body: some View {
        Screen {
            Text("Done with \(app.name)").titleStyle()
            AppSlip(app: app, use: use)
            Notice(.ok) {
                Text("It is confirmed on Base, and the result is in your safe.")
                ExplorerLink(label: "View \(Format.shortId(txHash)) on Base", url: Explorer.baseTx(txHash))
            }
        } actions: {
            Button("Back to my safe", action: onDone).buttonStyle(.primary)
        }
    }
}
