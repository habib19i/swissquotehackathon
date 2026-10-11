import SwiftUI

/// A USDC payment prepared by the core (apps/web/lib/wallet-usdc.ts `UsdcPayment`); `handle` sends it.
nonisolated struct UsdcPayment: Decodable {
    nonisolated struct Fee: Decodable {
        let paidBy: String
        /// What the client pays Swissquote in USDC (0 on Premium).
        let feeUsdc: Units
        let feeChf: Double
    }

    let handle: String
    let contact: Contact
    let amount: Units
    let fee: Fee
    /// "passkey": Face ID alone, within the rules. "mpc": the MPC key, after Swissquote's check.
    let signer: String
    /// USDC units Face ID alone may still pay today.
    let remainingToday: Units
    let review: Review?
}

extension Format {
    /// Whole cents, rounded down (packages/ethereum usdcForChf).
    static func usdcForChf(_ chf: Double, usdcChf: Double) -> Units {
        Units(Int64((chf / usdcChf * 100).rounded(.down)) * 10_000)
    }
}

/// USDC payments on Base: amount, confirmation card (Face ID), result. Mirrors apps/web/app/send/usdc.tsx.
struct UsdcSendView: View {
    let profile: WalletProfile
    let contact: Contact
    let onBack: () -> Void

    @State private var payment: UsdcPayment?
    @State private var sentHash: String?

    var body: some View {
        if let payment, let sentHash {
            UsdcSentView(payment: payment, txHash: sentHash, onDone: onBack)
        } else if let payment {
            UsdcConfirmView(payment: payment, onCancel: onBack) { sentHash = $0 }
        } else {
            UsdcAmountStep(profile: profile, contact: contact, onBack: onBack) { payment = $0 }
        }
    }
}

private struct UsdcAmountStep: View {
    let profile: WalletProfile
    let contact: Contact
    let onBack: () -> Void
    let onReady: (UsdcPayment) -> Void

    @Environment(Session.self) private var session
    @Environment(WalletCore.self) private var core
    @State private var input = ""
    @State private var balance: Units?
    @State private var today: Units?
    @State private var error: String?
    @State private var busy = false
    @FocusState private var focused: Bool

    private var chf: Double? { Format.parseChf(input).flatMap { $0 > 0 ? $0 : nil } }

    var body: some View {
        Screen {
            Text("How much for \(contact.name)?").titleStyle()
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text("CHF").font(.geist(24, .semibold))
                TextField("0.00", text: $input)
                    .font(.geist(48, .semibold))
                    .monospacedDigit()
                    .keyboardType(.decimalPad)
                    .focused($focused)
                    .accessibilityLabel("Amount in Swiss francs for \(contact.name), paid in USDC")
            }
            .padding(.bottom, 8)
            .overlay(alignment: .bottom) { Rectangle().fill(Theme.brand).frame(height: 2) }
            if let chf, let price = session.price {
                Text("About \(Format.usdc(Format.usdcForChf(chf, usdcChf: price.usdcChf)))").smallMuted().monospacedDigit()
            }
            VStack(spacing: 10) {
                DetailRow(label: "USDC", value: chfOf(balance))
                DetailRow(label: "Face ID alone, today", value: chfOf(today))
            }
            Text("Up to your daily limit, only your Face ID is needed: your account on Base checks it itself. Above it, Swissquote checks the payment and co-signs it.")
                .smallMuted()
            if let error { Notice(.error, error) }
        } actions: {
            Button(busy ? "Preparing…" : "Continue") { Task { await next() } }
                .buttonStyle(.primary).disabled(chf == nil || session.price == nil || busy)
            Button("Choose someone else", action: onBack).buttonStyle(.quiet)
        }
        .onAppear { focused = true }
        .task {
            do { balance = try await core.call("loadUsdcBalance", as: Units.self) }
            catch { self.error = error.localizedDescription }
            if let status = try? await core.call("cosigner.ethStatus", profile.walletId) {
                today = Units(status["onChain"]["remainingToday"])
            }
        }
    }

    private func chfOf(_ units: Units?) -> String {
        guard let units, let price = session.price else { return "…" }
        return Format.chf(Format.usdcChf(units, usdcChf: price.usdcChf))
    }

    private func next() async {
        guard let chf, let price = session.price else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            onReady(try await core.call("prepareUsdcPayment", contact, Format.usdcForChf(chf, usdcChf: price.usdcChf), as: UsdcPayment.self))
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct UsdcSlip: View {
    let payment: UsdcPayment
    @Environment(Session.self) private var session

    var body: some View {
        let swissquotePays = payment.fee.paidBy == "swissquote"
        Slip {
            Text("You send to \(payment.contact.name)").foregroundStyle(Theme.inkSoft)
            Text(chf(payment.amount)).font(Theme.Text.amount).monospacedDigit()
            Text(Format.usdc(payment.amount)).smallMuted().monospacedDigit()
        } details: {
            DetailRow(label: "To", value: payment.contact.relation.isEmpty ? payment.contact.name : "\(payment.contact.name) (\(payment.contact.relation))")
            DetailRow(label: "From", value: "USDC")
            DetailRow(label: "Network fee", value: swissquotePays
                      ? "\(Format.chf(payment.fee.feeChf)), paid by Swissquote"
                      : "\(chf(payment.fee.feeUsdc)) (\(Format.usdc(payment.fee.feeUsdc))), paid by you")
            DetailRow(label: "You pay in total", value: chf(payment.amount + payment.fee.feeUsdc))
        }
    }

    private func chf(_ units: Units) -> String {
        session.price.map { Format.chf(Format.usdcChf(units, usdcChf: $0.usdcChf)) } ?? "…"
    }
}

struct UsdcConfirmView: View {
    let payment: UsdcPayment
    let onCancel: () -> Void
    let onSent: (String) -> Void

    @Environment(Session.self) private var session
    @Environment(WalletCore.self) private var core
    @Environment(Navigation.self) private var navigation
    @State private var sending = false
    @State private var confirmed = false
    @State private var error: (text: String, txHash: String?)?

    private var blocked: Bool { payment.review?.verdict == "BLOCKED" }
    private var needsConfirmation: Bool { payment.review?.verdict == "NEEDS_CONFIRMATION" }

    var body: some View {
        Screen {
            Text(blocked ? "Payment stopped" : "Check your payment").titleStyle()
            UsdcSlip(payment: payment)
            if payment.signer == "passkey" {
                Text("Only your Face ID is needed: \(payment.contact.name) is an approved contact and this is within your daily limit. Your account on Base checks both itself. Swissquote does not sign it.")
                    .smallMuted()
            } else if !blocked {
                Text("This is more than Face ID alone can pay today (\(session.price.map { Format.chf(Format.usdcChf(payment.remainingToday, usdcChf: $0.usdcChf)) } ?? "…") left), so Swissquote checks it and co-signs it with your Face ID.")
                    .smallMuted()
            }
            if let review = payment.review { ReviewNotice(review: review) }
            if let error {
                Notice(.error) {
                    Text(error.text)
                    if let hash = error.txHash { ExplorerLink(label: "View \(Format.shortId(hash)) on Base", url: Explorer.baseTx(hash)) }
                }
            }
        } actions: {
            if blocked {
                Button("Back to my safe") { navigation.tab = .home }.buttonStyle(.primary)
            } else {
                if needsConfirmation && !confirmed {
                    Button("Yes, I want to make this payment") { confirmed = true }.buttonStyle(.primary)
                } else {
                    Button { Task { await confirm() } } label: {
                        FaceIdLabel(sending ? "Sending…" : "Confirm with Face ID")
                    }
                    .buttonStyle(.primary).disabled(sending)
                }
                Button("Cancel") {
                    Task { try? await core.call("release", payment.handle) }
                    onCancel()
                }
                .buttonStyle(.secondary).disabled(sending)
            }
        }
    }

    private func confirm() async {
        error = nil
        sending = true
        do {
            let sent = try await core.call("sendUsdcPayment", payment.handle, confirmed)
            guard let hash = sent["txHash"].string else { throw CoreError(name: "BadAnswer", message: "Base gave no transaction.") }
            onSent(hash)
        } catch let failure as CoreError {
            // The operation reached Base but failed there: show its transaction (apps/web OperationFailedError).
            error = (failure.message == "cancelled" ? "Face ID was cancelled. Nothing was sent." : failure.message, failure.sentTxHash)
            sending = false
        } catch {
            self.error = (error.localizedDescription, nil)
            sending = false
        }
    }
}

private struct UsdcSentView: View {
    let payment: UsdcPayment
    let txHash: String
    let onDone: () -> Void
    @Environment(Navigation.self) private var navigation

    var body: some View {
        Screen {
            Text("Sent to \(payment.contact.name)").titleStyle()
            UsdcSlip(payment: payment)
            Notice(.ok) {
                Text("\(payment.contact.name) has received it: Base confirms payments within seconds.")
                ExplorerLink(label: "View payment \(Format.shortId(txHash)) on Base", url: Explorer.baseTx(txHash))
            }
        } actions: {
            Button("Back to my safe") {
                onDone()
                navigation.tab = .home
            }
            .buttonStyle(.primary)
        }
    }
}
