import SwiftUI

/// Home (screen 3): total in CHF, the pockets side by side, Swissquote's protection, and the actions that
/// need the client (finish setup, refill, move the extra to savings). Mirrors apps/web/app/page.tsx.
struct HomeView: View {
    let profile: WalletProfile

    @Environment(Session.self) private var session
    @Environment(WalletCore.self) private var core
    @Environment(Navigation.self) private var navigation

    @State private var balances: Balances?
    @State private var balanceError: String?
    /// Swissquote's record of this safe; `.null` when Swissquote does not know it yet.
    @State private var record: JSONValue?
    /// USDC units; nil while loading, `.none` inside when USDC are not available on this phone.
    @State private var usdc: Units??
    @State private var onBase: JSONValue?
    @State private var positions: (eth: Units, ethInAave: Units)?
    @State private var online = true
    @State private var recoveryKey: Bool?
    @State private var urgent: String?
    @State private var hidden = false
    @State private var busy = false
    @State private var done: Done?
    @State private var error: String?

    /// The outcome of a Face ID action, with its transaction on either network.
    private struct Done {
        var text: String
        var txid: String?
        var baseTx: String?
    }

    /// Above this share of its size, the extra in the pocket is offered back to the Savings safe.
    private static let pocketExcessMargin = 1.2
    /// Below this share of its size, the pocket is offered a refill (packages/bitcoin REFILL_THRESHOLD).
    private static let refillThreshold = 0.5

    private var price: PriceQuote? { session.price }
    private var pocket: Units? { balances?.pocket.total }
    private var savings: Units? { balances?.savings.total }
    private var verified: Bool { record.map { !$0["ownershipVerifiedAt"].isNull } ?? false }

    var body: some View {
        Screen(tabs: true) {
            header
            balance
            quickActions
            notices
            Text("Your pockets").sectionStyle().padding(.top, 4)
            pockets
            AskBox()
            pocketActions
            keyCard
            Button("Demo panel") { navigation.homePath.append(Route.demo) }.buttonStyle(.quiet)
            footer
        }
        .refreshable { await load() }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(20))
            }
        }
    }

    // MARK: - Sections

    /// `.home-head`: the client's initials, greeting and name; alerts and settings.
    private var header: some View {
        HStack(spacing: 12) {
            Avatar(text: profile.client.initials)
            VStack(alignment: .leading, spacing: 0) {
                Text(Format.greeting()).smallMuted()
                Text(profile.client.firstName).rowTitle()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            RoundIconButton(icon: "bell", label: urgent == nil ? "Alerts" : "Alerts: one needs your attention", dot: urgent != nil) {
                navigation.homePath.append(Route.alerts)
            }
            RoundIconButton(icon: "gear", label: "Plan and settings") {
                navigation.homePath.append(Route.settings)
            }
        }
    }

    /// `.balance`: the total in francs, centred; tapping it hides the amounts.
    private var balance: some View {
        let usdcChf = (usdc ?? nil).flatMap { units in price.map { Format.usdcChf(units, usdcChf: $0.usdcChf) } } ?? 0
        let ethWei = (positions?.eth.value ?? 0) + (positions?.ethInAave.value ?? 0)
        let total = pocket.flatMap { p in savings.map { p + $0 } }
        let totalChf = total.flatMap { total in price.map { Format.satsToChf(total, btcChf: $0.btcChf) + usdcChf + ethChf(ethWei) } }

        return VStack(spacing: 6) {
            Text("Total value").foregroundStyle(Theme.inkSoft)
            Button { hidden.toggle() } label: {
                HStack(spacing: 10) {
                    Text(totalChf.map { hide(Format.chf($0)) } ?? "…")
                        .font(.geist(46.8, .bold)).kerning(-1.4).monospacedDigit()
                        .lineLimit(1).minimumScaleFactor(0.6)
                    Icon(hidden ? "eye-off" : "eye", size: 22).foregroundStyle(Theme.inkSoft)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(hidden ? "Show amounts" : "Hide amounts")
            if let total, !hidden {
                let usdcText = (usdc ?? nil).flatMap { $0.value > 0 ? " · \(Format.usdc($0))" : nil } ?? ""
                Text(Format.btc(total) + usdcText).smallMuted().monospacedDigit()
            }
            // The largest size at which the whole chip fits on one line, as on the web.
            ViewThatFits(in: .horizontal) {
                protectionChip(size: 15.75)
                protectionChip(size: 14)
                protectionChip(size: 12.5)
            }
            .padding(.top, 6)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 12)
        .padding(.bottom, 4)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Your safe")
    }

    /// `.chip`: "Protected by Swissquote · Verified yours", in green on a white pill.
    private func protectionChip(size: CGFloat) -> some View {
        HStack(spacing: 6) {
            Icon("shield", size: size + 2)
            Text("Protected by Swissquote")
            if verified {
                Text("·")
                Icon("check", size: size)
                Text("Verified yours")
            }
        }
        .font(.geist(size, .semibold))
        .lineLimit(1)
        .fixedSize()
        .foregroundStyle(Theme.protect)
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
        .background(Theme.surface, in: .capsule)
        .cardShadow()
    }

    /// `.quick-actions`: four cards with an orange disc.
    private var quickActions: some View {
        HStack(spacing: 10) {
            QuickAction(title: "Receive", icon: "receive") { navigation.homePath.append(Route.receive) }
            QuickAction(title: "Send", icon: "send") { navigation.tab = .send }
            QuickAction(title: "Activity", icon: "clock") { navigation.homePath.append(Route.activity) }
            QuickAction(title: "Rules", icon: "rules") { navigation.tab = .rules }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Quick actions")
    }

    @ViewBuilder private var notices: some View {
        if !online {
            Notice(.warn, "Swissquote is offline. Your Spending pocket works as usual. Larger payments from your Savings safe use your recovery key and the independent safe-keeper instead. USDC payments wait until Swissquote is back: in this prototype, Swissquote relays them to the network.")
        }
        if let urgent {
            Button { navigation.homePath.append(Route.alerts) } label: {
                Notice(.warn) {
                    Text("Swissquote alert").rowTitle()
                    Text(urgent)
                }
            }
            .buttonStyle(.pressable)
        }
        if recoveryKey == false && verified {
            Button { navigation.homePath.append(Route.recoveryKey) } label: {
                Notice(.warn) {
                    Text("Add your recovery key").rowTitle()
                    Text("Without it, nobody can bring your safe back if you lose this phone.")
                }
            }
            .buttonStyle(.pressable)
        }
        if record == .null {
            Notice(.warn) {
                Text("Swissquote has not verified this safe yet. Finish setting it up to use your Savings safe.")
                Button("Finish setting up with Face ID") {
                    act { try await core.call("finishSetupWithFaceId"); return Done(text: "Swissquote has verified that this safe is yours.") }
                }
                .buttonStyle(.primary).disabled(busy).padding(.top, 6)
            }
        }
        if let onBase, online, onBase["rulesUpToDate"].bool == false || onBase["passkeyUpToDate"].bool == false {
            Notice(.warn) {
                Text("Your USDC account needs your new rules").rowTitle()
                Text("Your account on Base still follows your previous rules or Face ID. Confirm to bring it up to date.")
                Button("Update with Face ID") {
                    act {
                        let sent = try await core.call("updateRulesOnBase")
                        return Done(text: "Your USDC account now follows your rules.", baseTx: sent["txHash"].string)
                    }
                }
                .buttonStyle(.primary).disabled(busy).padding(.top, 6)
            }
        }
        if verified, let ethereum = record?["ethereum"], !ethereum.isNull, ethereum["ownershipVerifiedAt"].isNull, online {
            Notice {
                Text("Swissquote has not verified your USDC account yet. It takes one Face ID.")
                Button("Verify with Face ID") {
                    act { try await core.call("proveUsdcOwnership"); return Done(text: "Swissquote has verified that your USDC account is yours.") }
                }
                .buttonStyle(.secondary).disabled(busy).padding(.top, 6)
            }
        }
        if let error = error ?? balanceError { Notice(.error, error) }
        if let done {
            Notice(.ok) {
                Text(done.text)
                if let txid = done.txid { ExplorerLink(label: "View \(Format.shortId(txid)) on the Bitcoin network", url: Explorer.btcTx(txid)) }
                if let hash = done.baseTx { ExplorerLink(label: "View \(Format.shortId(hash)) on Base", url: Explorer.baseTx(hash)) }
            }
        }
        if let balances, (balances.pocket.pending + balances.savings.pending).value > 0 {
            Notice("\(Format.chf(balances.pocket.pending + balances.savings.pending, btcChf: price?.btcChf)) is on its way. Bitcoin payments usually arrive within 10 minutes.")
        }
    }

    /// `.assets`: one card per pocket, the franc value and the coin amount on the right.
    private var pockets: some View {
        VStack(spacing: 10) {
            Button { navigation.tab = .send } label: {
                PocketRow(token: .btc, title: "Spending pocket", subtitle: "Bitcoin · Face ID only",
                          amount: pocket.map { hide(Format.chf($0, btcChf: price?.btcChf)) }, detail: pocket.map(Format.btc), hidden: hidden)
            }
            Button { navigation.tab = .send } label: {
                PocketRow(token: .btc, badge: .vault, title: "Savings safe", subtitle: "Bitcoin · checked by Swissquote",
                          amount: savings.map { hide(Format.chf($0, btcChf: price?.btcChf)) }, detail: savings.map(Format.btc), hidden: hidden)
            }
            Button { navigation.tab = .send } label: {
                let units = usdc ?? nil
                PocketRow(token: .usdc, title: "USDC",
                          subtitle: usdc != nil && units == nil ? "Not available on this phone" : "On Base · Face ID within your limit",
                          amount: usdc == nil ? nil : units.map { u in hide(price.map { Format.chf(Format.usdcChf(u, usdcChf: $0.usdcChf)) } ?? "…") } ?? "–",
                          detail: units.flatMap { $0.value > 0 ? Format.usdc($0) : nil }, hidden: hidden)
            }
            if let positions, positions.eth.value > 0 {
                Button { navigation.tab = .explore } label: {
                    PocketRow(token: .eth, title: "ETH", subtitle: "On Base · from Uniswap",
                              amount: hide(Format.chf(ethChf(positions.eth.value))), detail: Format.eth(positions.eth), hidden: hidden)
                }
            }
            if let positions, positions.ethInAave.value > 0 {
                Button { navigation.tab = .explore } label: {
                    PocketRow(token: .eth, badge: .app("A"), title: "ETH earning in Aave", subtitle: "Interest added every second",
                              amount: hide(Format.chf(ethChf(positions.ethInAave.value))), detail: Format.eth(positions.ethInAave), hidden: hidden)
                }
            }
        }
        .buttonStyle(.pressable)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Your pockets")
    }

    @ViewBuilder private var pocketActions: some View {
        if let price, let pocket {
            let pocketSize = Format.chfToSats(Format.defaultPocketChf, btcChf: price.btcChf)
            let excess = Double(pocket.value) > Double(pocketSize.value) * Self.pocketExcessMargin ? pocket - pocketSize : .zero
            let refill = (savings?.value ?? 0) > 0 && Double(pocket.value) < Double(pocketSize.value) * Self.refillThreshold ? pocketSize - pocket : .zero
            if excess.value > 0 {
                Button("Move \(Format.chf(excess, btcChf: price.btcChf)) to my Savings safe") {
                    act {
                        let txid = try await core.call("moveExcessToSavings", excess).string
                        return Done(text: "\(Format.chf(excess, btcChf: price.btcChf)) is moving to your Savings safe.", txid: txid)
                    }
                }
                .buttonStyle(.secondary).disabled(busy)
            }
            if refill.value > 0 && verified {
                Button("Refill my Spending pocket") {
                    act {
                        let outcome = try await core.call("refillPocketNow", price.btcChf)
                        if let failure = outcome["error"].string { throw CoreError(name: "RefillError", message: failure) }
                        if outcome.isNull { return nil }
                        return Done(text: "\(Format.chf(Units(outcome["amount"]), btcChf: price.btcChf)) is moving to your Spending pocket.",
                                    txid: outcome["txid"].string)
                    }
                }
                .buttonStyle(.secondary).disabled(busy)
            }
        }
    }

    /// `.card`: who holds the key.
    private var keyCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("One key, three pieces").rowTitle()
            Text("Any two can sign. Swissquote alone never can.").smallMuted()
            KeyHolders(ready: [true, true, true]).padding(.top, 10)
        }
        .card()
    }

    private var footer: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text("Test bitcoin on the Bitcoin test network and test USDC on Base Sepolia, shown at the \(price?.mock == true ? "fixed demo" : "live") price for illustration.")
                .smallMuted()
            if price?.mock == true { MockTag() }
        }
    }

    // MARK: - Data

    private func hide(_ text: String) -> String { hidden ? "••••" : text }

    private func ethChf(_ wei: Int64) -> Double { price.map { Double(wei) / 1e18 * $0.ethChf } ?? 0 }

    private func load() async {
        async let balancesTask = core.call("loadBalances", as: Balances.self)
        async let recordTask = core.call("swissquoteRecord", profile.walletId)
        async let usdcTask = core.call("loadUsdcBalance", as: Units.self)
        async let positionsTask = core.call("loadPositions")
        async let onlineTask = core.call("swissquoteOnline")
        async let recoveryTask = core.call("hasRecoveryKey", profile.walletId)
        async let alertsTask = core.call("cosigner.alerts", profile.walletId)

        do {
            balances = try await balancesTask
            balanceError = nil
        } catch {
            balanceError = "Balances could not be loaded from the Bitcoin network. Retrying…"
        }
        record = try? await recordTask
        if let units = try? await usdcTask {
            usdc = .some(units)
            onBase = try? await core.call("cosigner.ethStatus", profile.walletId)
        } else if usdc == nil {
            usdc = .some(nil)
        }
        if let value = try? await positionsTask {
            positions = (Units(value["eth"]), Units(value["ethInAave"]))
        }
        online = (try? await onlineTask)?.bool ?? false
        recoveryKey = (try? await recoveryTask)?.bool
        urgent = (try? await alertsTask).flatMap(Self.openRequest)
    }

    /// The latest alert the client may need to act on: a change on hold, or a recovery under way. Alerts are
    /// newest first: a request is still open if nothing newer concerns the same change or recovery.
    private static func openRequest(in alerts: JSONValue) -> String? {
        let list = alerts.array
        for (index, alert) in list.enumerated() {
            guard ["rulebook-change-requested", "recovery-started"].contains(alert["type"].string ?? "") else { continue }
            let newer = list[..<index]
            let closed = newer.contains { other in
                (alert["changeId"].string != nil && other["changeId"] == alert["changeId"])
                    || (alert["recoveryId"].string != nil && other["recoveryId"] == alert["recoveryId"])
            }
            if !closed { return alert["message"].string }
        }
        return nil
    }

    private func act(_ action: @escaping () async throws -> Done?) {
        Task {
            busy = true
            done = nil
            error = nil
            defer { busy = false }
            do {
                done = try await action()
                await load()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// The assistant, front and centre (`.ask`): type a request; the Assistant tab takes it from there and ends
/// on a card the client accepts with Face ID.
private struct AskBox: View {
    @Environment(Navigation.self) private var navigation
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 12) {
            Text("What would you like to do today?").font(.geist(24, .semibold)).kerning(-0.24)
                .multilineTextAlignment(.center)
            HStack(spacing: 6) {
                TextField("", text: $text, prompt: Text("Send 20 francs to Léo").foregroundStyle(Theme.inkSoft))
                    .font(Theme.Text.m)
                    .frame(minHeight: 52)
                    .focused($focused)
                    .submitLabel(.send)
                    .onSubmit(send)
                    .accessibilityLabel("Ask the assistant")
                Button(action: send) {
                    Icon("arrow-up", size: 22)
                        .frame(width: 52, height: 52)
                        .foregroundStyle(empty ? Theme.inkSoft : Theme.onBrand)
                        .background(empty ? Theme.surfaceAlt : Theme.brand, in: .circle)
                }
                .buttonStyle(.pressable)
                .disabled(empty)
                .accessibilityLabel("Ask the assistant")
            }
            .padding(.leading, 20)
            .padding([.trailing, .vertical], 6)
            .background(Theme.surface, in: .capsule)
            .overlay(Capsule().strokeBorder(focused ? Theme.brand : .clear, lineWidth: 2))
            .cardShadow(.m)
            Text("The assistant only prepares the payment. You confirm it with Face ID.").smallMuted()
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Assistant")
    }

    private var empty: Bool { text.trimmingCharacters(in: .whitespaces).isEmpty }

    private func send() {
        let request = text.trimmingCharacters(in: .whitespaces)
        guard !request.isEmpty else { return }
        navigation.assistantRequest = request
        navigation.tab = .assistant
        text = ""
    }
}

private struct PocketRow: View {
    let token: TokenMark.Token
    var badge: TokenMark.Badge?
    let title: String
    let subtitle: String
    let amount: String?
    let detail: String?
    let hidden: Bool

    var body: some View {
        RowCard(title: title, subtitle: subtitle) {
            TokenMark(token: token, badge: badge)
        } trailing: {
            VStack(alignment: .trailing, spacing: 2) {
                Text(amount ?? "…").rowTitle().monospacedDigit()
                if let detail, !hidden { Text(detail).smallMuted().monospacedDigit() }
            }
            .fixedSize()
        }
    }
}

/// `.quick-action`: a white card with an orange disc and the action's name.
private struct QuickAction: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Icon(icon, size: 24)
                    .frame(width: 46, height: 46)
                    .background(Theme.brand, in: .circle)
                    .foregroundStyle(Theme.onBrand)
                Text(title).font(.geist(15.3, .semibold)).foregroundStyle(Theme.ink).lineLimit(1).minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 14)
            .padding(.bottom, 12)
            .padding(.horizontal, 4)
            .background(Theme.surface, in: .rect(cornerRadius: Theme.radiusCard))
            .cardShadow()
        }
        .buttonStyle(.pressable)
    }
}

/// `.round-button`: a white disc with an icon, and an orange dot when something needs attention.
struct RoundIconButton: View {
    let icon: String
    let label: String
    var dot = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Icon(icon, size: 24)
                .frame(width: 52, height: 52)
                .foregroundStyle(Theme.ink)
                .background(Theme.surface, in: .circle)
                .cardShadow()
                .overlay(alignment: .topTrailing) {
                    if dot {
                        Circle().fill(Theme.brand).frame(width: 11, height: 11)
                            .overlay(Circle().strokeBorder(Theme.surface, lineWidth: 2).padding(-2))
                            .offset(x: -11, y: 10)
                    }
                }
        }
        .buttonStyle(.pressable)
        .accessibilityLabel(label)
    }
}

extension Units {
    /// A bigint field from a plain JSON answer.
    init(_ json: JSONValue) {
        self.init(json.string.flatMap { Int64($0) } ?? json.number.map { Int64($0) } ?? 0)
    }
}

extension Format {
    static func eth(_ wei: Units) -> String {
        "ETH " + (Double(wei.value) / 1e18).formatted(.number.precision(.fractionLength(4...6)).locale(Locale(identifier: "en_CH")))
    }
}
