import SwiftUI

/// The Bitcoin confirmation card (Face ID) and the result. Mirrors apps/web/app/send/bitcoin.tsx; the
/// assistant will reuse both.
struct BitcoinConfirmView: View {
    let payment: PreparedPayment
    let onCancel: () -> Void
    let onSent: (PaymentResult) -> Void

    @Environment(Session.self) private var session
    @Environment(WalletCore.self) private var core
    @Environment(Navigation.self) private var navigation
    @State private var sending = false
    @State private var confirmed = false
    @State private var error: String?

    private var review: Review? { payment.from == "savings" ? payment.review : nil }
    private var blocked: Bool { review?.verdict == "BLOCKED" }
    private var needsConfirmation: Bool { review?.verdict == "NEEDS_CONFIRMATION" }

    var body: some View {
        Screen {
            Text(blocked ? "Payment stopped" : "Check your payment").titleStyle()
            PaymentSlip(payment: payment)
            if payment.from == "pocket" {
                Text("Payments from your Spending pocket only need your Face ID. Swissquote does not sign them.").smallMuted()
            }
            if payment.from == "savings" && payment.via == "recovery-provider" {
                Notice(.warn, "Swissquote is offline, so your recovery key and the independent safe-keeper approve this payment instead. You will be asked for your Face ID, then for your recovery key.")
            }
            if let review { ReviewNotice(review: review) }
            if let error { Notice(.error, error) }
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
                    .buttonStyle(.primary)
                    .disabled(sending || session.price == nil)
                }
                Button("Cancel") {
                    Task { try? await core.call("release", payment.handle) }
                    onCancel()
                }
                .buttonStyle(.secondary)
                .disabled(sending)
            }
        }
    }

    private func confirm() async {
        guard let price = session.price else { return }
        error = nil
        sending = true
        do {
            onSent(try await core.call("sendPayment", payment.handle, price.btcChf, confirmed, as: PaymentResult.self))
        } catch {
            self.error = error.localizedDescription == "cancelled" ? "Face ID was cancelled. Nothing was sent." : error.localizedDescription
            sending = false
        }
    }
}

/// Swissquote's verdict on a Savings safe payment, with its reasons.
struct ReviewNotice: View {
    let review: Review

    var body: some View {
        Notice(review.verdict == "APPROVE" ? .ok : review.verdict == "BLOCKED" ? .error : .warn) {
            IconLabel(review.verdict == "APPROVE" ? "Checked by Swissquote"
                  : review.verdict == "BLOCKED" ? "Stopped by Swissquote" : "Swissquote asks you to check", icon: "shield")
                .font(.geist(18, .semibold))
            ForEach(review.reasons, id: \.self) { Text($0) }
        }
    }
}

struct PaymentSlip: View {
    let payment: PreparedPayment
    @Environment(Session.self) private var session

    var body: some View {
        let spend = payment.draft.spend
        let swissquotePays = spend.paidBy == "swissquote"
        let btcChf = session.price?.btcChf
        Slip(note: payment.draft.feeNote) {
            Text("You send to \(payment.contact.name)").foregroundStyle(Theme.inkSoft)
            Text(Format.chf(spend.amount, btcChf: btcChf)).font(Theme.Text.amount).monospacedDigit()
            Text(Format.btc(spend.amount)).smallMuted().monospacedDigit()
        } details: {
            DetailRow(label: "To", value: "\(payment.contact.name) (\(payment.contact.relation))")
            DetailRow(label: "From", value: payment.from == "pocket" ? "Spending pocket" : "Savings safe")
            DetailRow(label: "Network fee", value: "\(Format.chf(spend.fee, btcChf: btcChf)), paid by \(swissquotePays ? "Swissquote" : "you")")
            DetailRow(label: "You pay in total", value: Format.chf(swissquotePays ? spend.amount : spend.amount + spend.fee, btcChf: btcChf))
        }
    }
}

struct BitcoinSentView: View {
    let payment: PreparedPayment
    let result: PaymentResult
    let onDone: () -> Void

    @Environment(Session.self) private var session
    @Environment(Navigation.self) private var navigation

    var body: some View {
        Screen {
            Text("Sent to \(payment.contact.name)").titleStyle()
            PaymentSlip(payment: payment)
            Notice(.ok) {
                Text("Your payment is on the Bitcoin network. It usually arrives within 10 minutes.")
                ExplorerLink(label: "View payment \(Format.shortId(result.txid)) on the Bitcoin network", url: Explorer.btcTx(result.txid))
            }
            if let refill = result.refill, let txid = refill.txid {
                Notice {
                    Text("Your Spending pocket was running low, so \(Format.chf(refill.amount ?? .zero, btcChf: session.price?.btcChf)) moved to it from your Savings safe, checked by Swissquote.")
                    ExplorerLink(label: "View refill \(Format.shortId(txid))", url: Explorer.btcTx(txid))
                }
            }
            if let failure = result.refill?.error { Notice(failure) }
        } actions: {
            Button("Back to my safe") {
                onDone()
                navigation.tab = .home
            }
            .buttonStyle(.primary)
        }
    }
}
