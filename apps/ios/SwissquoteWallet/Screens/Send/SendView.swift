import SwiftUI

/// Send (screen 4): pick a contact, the asset when they can receive both, the amount, then the
/// confirmation card and Face ID. Mirrors apps/web/app/send/page.tsx.
struct SendView: View {
    let profile: WalletProfile

    private enum Step {
        case contact
        /// The contact can receive bitcoin and USDC: the client chooses.
        case asset(Contact)
        case usdc(Contact)
        case amount(Contact)
        case confirm(PreparedPayment)
        case sent(PreparedPayment, PaymentResult)
    }

    @State private var step = Step.contact

    var body: some View {
        switch step {
        case .contact:
            ContactStep(profile: profile) { step = firstStep(for: $0) }
        case .asset(let contact):
            AssetStep(contact: contact, onBack: { step = .contact }) { asset in
                step = asset == "USDC" ? .usdc(contact) : .amount(contact)
            }
        case .usdc(let contact):
            UsdcSendView(profile: profile, contact: contact) { step = .contact }
        case .amount(let contact):
            AmountStep(contact: contact, onBack: { step = .contact }) { step = .confirm($0) }
        case .confirm(let payment):
            BitcoinConfirmView(payment: payment, onCancel: { step = .contact }) { step = .sent(payment, $0) }
        case .sent(let payment, let result):
            BitcoinSentView(payment: payment, result: result) { step = .contact }
        }
    }

    /// Asks for the asset only when the contact can receive both.
    private func firstStep(for contact: Contact) -> Step {
        if contact.canReceiveBitcoin && contact.canReceiveUsdc { return .asset(contact) }
        return contact.canReceiveUsdc ? .usdc(contact) : .amount(contact)
    }
}

/// The approved contacts from the rulebook (Swissquote's copy, or this phone's when Swissquote is offline).
private struct ContactStep: View {
    let profile: WalletProfile
    let onPick: (Contact) -> Void

    @Environment(WalletCore.self) private var core
    @Environment(Navigation.self) private var navigation
    @State private var contacts: [Contact]?
    @State private var error: String?

    var body: some View {
        Screen(tabs: true) {
            Text("Who do you want to pay?").titleStyle()
            if let error { Notice(.error, error) }
            if contacts?.isEmpty == true { Text("You have no contacts yet.").leadStyle() }
            VStack(spacing: 12) {
                ForEach(contacts ?? []) { contact in
                    Button { onPick(contact) } label: {
                        RowCard(title: contact.name, subtitle: contact.relation) {
                            Avatar(text: String(contact.name.prefix(1)))
                        } trailing: {
                            Image(systemName: "chevron.right").foregroundStyle(Theme.inkSoft)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            if contacts == nil && error == nil { ProgressView().frame(maxWidth: .infinity) }
            Text("To pay someone new, add them as a contact in Rules. Swissquote checks them for you, and they become a contact after a waiting period.")
                .smallMuted()
            Button("Open my rules") { navigation.tab = .rules }.buttonStyle(.quiet)
        }
        .task { await load() }
    }

    private func load() async {
        do {
            contacts = try await core.call("loadRulebook", profile.walletId)["contacts"].array.map(Contact.init(json:))
        } catch {
            self.error = "Your contacts could not be loaded: \(error.localizedDescription)"
        }
    }
}

/// Bitcoin or USDC, with what each can pay.
private struct AssetStep: View {
    let contact: Contact
    let onBack: () -> Void
    let onPick: (String) -> Void

    @Environment(Session.self) private var session
    @Environment(WalletCore.self) private var core
    @State private var btc: Units?
    @State private var usdc: Result<Units, CoreError>?

    var body: some View {
        Screen {
            Text("What do you want to send to \(contact.name)?").titleStyle()
            VStack(spacing: 12) {
                Button { onPick("BTC") } label: {
                    RowCard(title: "Bitcoin", subtitle: "From your Spending pocket or Savings safe") {
                        TokenMark(token: .btc, size: 40)
                    } trailing: {
                        Text(btc.map { Format.chf($0, btcChf: session.price?.btcChf) } ?? "…").monospacedDigit()
                    }
                }
                Button { onPick("USDC") } label: {
                    RowCard(title: "USDC", subtitle: usdcSubtitle) {
                        TokenMark(token: .usdc, size: 40)
                    } trailing: {
                        Text(usdcAmount).monospacedDigit()
                    }
                }
                .disabled(usdcUnavailable)
            }
            .buttonStyle(.plain)
            Text("Amounts are what you can send in one payment.").smallMuted()
        } actions: {
            Button("Choose someone else", action: onBack).buttonStyle(.quiet)
        }
        .task {
            if let funds = try? await core.call("available") {
                let pocket = Units(funds["pocket"]), savings = Units(funds["savings"])
                btc = max(pocket, savings)
            }
            do { usdc = .success(try await core.call("loadUsdcBalance", as: Units.self)) }
            catch { usdc = .failure(error as? CoreError ?? CoreError(name: "Error", message: error.localizedDescription)) }
        }
    }

    private var usdcUnavailable: Bool {
        if case .failure = usdc { return true }
        return false
    }

    private var usdcSubtitle: String {
        if case .failure(let error) = usdc { return error.message }
        return "USDC, arrives within seconds"
    }

    private var usdcAmount: String {
        guard case .success(let units) = usdc, let price = session.price else { return "…" }
        return Format.chf(Format.usdcChf(units, usdcChf: price.usdcChf))
    }
}

private struct AmountStep: View {
    let contact: Contact
    let onBack: () -> Void
    let onReady: (PreparedPayment) -> Void

    @Environment(Session.self) private var session
    @Environment(WalletCore.self) private var core
    @State private var input = ""
    @State private var funds: (pocket: Units, savings: Units)?
    @State private var error: String?
    @State private var busy = false
    @FocusState private var focused: Bool

    private var chf: Double? { Format.parseChf(input).flatMap { $0 > 0 ? $0 : nil } }
    private var valid: Bool { chf != nil && session.price != nil }

    var body: some View {
        Screen {
            Text("How much for \(contact.name)?").titleStyle()
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text("CHF").font(Theme.Text.l).foregroundStyle(Theme.inkSoft)
                TextField("0.00", text: $input)
                    .font(Theme.Text.amount)
                    .monospacedDigit()
                    .keyboardType(.decimalPad)
                    .focused($focused)
                    .accessibilityLabel("Amount in Swiss francs for \(contact.name)")
            }
            .padding(.vertical, 8)
            if let chf, let price = session.price {
                Text("About \(Format.btc(Format.chfToSats(chf, btcChf: price.btcChf)))").smallMuted().monospacedDigit()
            }
            VStack(spacing: 10) {
                DetailRow(label: "Spending pocket", value: funds.map { Format.chf($0.pocket, btcChf: session.price?.btcChf) } ?? "…")
                DetailRow(label: "Savings safe", value: funds.map { Format.chf($0.savings, btcChf: session.price?.btcChf) } ?? "…")
            }
            Text("Up to your Spending pocket’s balance, only your Face ID is needed. Larger payments come from your Savings safe, after Swissquote’s check.")
                .smallMuted()
            if let error { Notice(.error, error) }
        } actions: {
            Button(busy ? "Preparing…" : "Continue") { Task { await next() } }
                .buttonStyle(.primary).disabled(!valid || busy)
            Button("Pay from my Savings safe") { Task { await next(from: "savings") } }
                .buttonStyle(.secondary).disabled(!valid || busy)
            Button("Choose someone else", action: onBack).buttonStyle(.quiet)
        }
        .onAppear { focused = true }
        .task {
            do {
                let available = try await core.call("available")
                funds = (Units(available["pocket"]), Units(available["savings"]))
            } catch {
                self.error = "Your balances could not be loaded. Try again in a moment."
            }
        }
    }

    private func next(from: String? = nil) async {
        guard let chf, let price = session.price else { return }
        busy = true
        error = nil
        defer { busy = false }
        let sats = Format.chfToSats(chf, btcChf: price.btcChf)
        do {
            let payment = from == nil
                ? try await core.call("preparePayment", contact, sats, as: PreparedPayment.self)
                : try await core.call("preparePayment", contact, sats, "savings", as: PreparedPayment.self)
            onReady(payment)
        } catch let failure as CoreError {
            let chfOf = { (units: String?) in Format.chf(Units(units.flatMap { Int64($0) } ?? 0), btcChf: price.btcChf) }
            error = switch failure.name {
            case "NotEnoughInOnePocketError":
                "A payment comes from one pocket at a time. Your Spending pocket can pay up to \(chfOf(failure.pocketMax)) and your Savings safe up to \(chfOf(failure.savingsMax))."
            case "InsufficientFundsError":
                "Your Savings safe can pay up to \(chfOf(failure.available))."
            default:
                failure.message
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
