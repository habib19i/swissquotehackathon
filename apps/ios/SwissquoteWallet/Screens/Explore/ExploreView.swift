import SwiftUI

/// Explore: DeFi apps Swissquote has looked at. A curated list, not the open web.
/// Mirrors apps/web/app/explore/page.tsx.
struct ExploreView: View {
    let profile: WalletProfile

    @Environment(WalletCore.self) private var core
    @State private var query = ""
    @State private var apps: [JSONValue] = []
    @State private var approved: Set<String> = []

    var body: some View {
        Screen(tabs: true) {
            Text("Explore").titleStyle()
            Text("Apps Swissquote has checked for you. Whatever you get back always lands in your own safe.").leadStyle()
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.inkSoft)
                TextField("Search: exchange, earn, Aave…", text: $query)
                    .font(Theme.Text.m)
                    .autocorrectionDisabled()
                    .accessibilityLabel("Search apps")
            }
            .padding(14)
            .background(Theme.surface, in: .capsule)
            NavigationLink { ConnectAppView(profile: profile) } label: {
                Label("Scan an app’s QR code", systemImage: "qrcode.viewfinder")
            }
            .buttonStyle(.secondary)
            if apps.isEmpty && !query.isEmpty { Text("No app matches “\(query)”.").leadStyle() }
            VStack(spacing: 12) {
                ForEach(apps.indices, id: \.self) { index in
                    let app = apps[index]
                    let id = app["id"].string ?? ""
                    NavigationLink { AppDetailView(profile: profile, appId: id) } label: {
                        RowCard(title: app["name"].string ?? id, subtitle: app["tagline"].string) {
                            AppLogo(id: id, size: 46)
                        } trailing: {
                            Text(approved.contains(id) ? "Face ID" : app["category"].string ?? "")
                                .font(.system(size: 14, weight: .semibold))
                                .padding(.horizontal, 10).padding(.vertical, 4)
                                .background(approved.contains(id) ? Theme.protectBg : Theme.surfaceAlt, in: .capsule)
                                .foregroundStyle(approved.contains(id) ? Theme.protect : Theme.inkSoft)
                            Image(systemName: "chevron.right").foregroundStyle(Theme.inkSoft)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Apps")
        }
        .task(id: query) {
            apps = (try? await core.call("apps.search", query))?.array ?? []
        }
        .task {
            approved = Set(((try? await core.call("loadRulebook", profile.walletId))?["apps"].array ?? []).compactMap(\.string))
        }
    }
}

/// The app's own logo (from DefiLlama's icon service, as on the web), bundled with the app.
struct AppLogo: View {
    let id: String
    var size: CGFloat = 46

    var body: some View {
        Group {
            if let path = Bundle.main.path(forResource: id, ofType: "webp"), let image = UIImage(contentsOfFile: path) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Text(String(id.prefix(1)).uppercased()).font(.system(size: size * 0.45, weight: .bold))
                    .frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.brandTint)
            }
        }
        .frame(width: size, height: size)
        .clipShape(.rect(cornerRadius: size * 0.25))
        .accessibilityHidden(true)
    }
}

/// An app's page: what it does, its panel (exchange or Aave), and "Use with Face ID alone".
/// Mirrors apps/web/app/explore/[id]/page.tsx.
struct AppDetailView: View {
    let profile: WalletProfile
    let appId: String

    private enum Phase {
        case panel
        case confirm(AppUse)
        case done(AppUse, String)
    }

    @Environment(WalletCore.self) private var core
    @Environment(Navigation.self) private var navigation
    @Environment(\.dismiss) private var dismiss
    @State private var app: JSONValue?
    @State private var phase = Phase.panel

    private var defiApp: DefiApp { DefiApp(id: appId, name: app?["name"].string ?? appId) }

    var body: some View {
        switch phase {
        case .confirm(let use):
            AppConfirmView(app: defiApp, use: use, onCancel: { phase = .panel }) { phase = .done(use, $0) }
        case .done(let use, let hash):
            AppDoneView(app: defiApp, use: use, txHash: hash) {
                dismiss()
                navigation.tab = .home
            }
        case .panel:
            Screen {
                HStack(spacing: 16) {
                    AppLogo(id: appId, size: 64)
                    VStack(alignment: .leading) {
                        Text(defiApp.name).titleStyle()
                        Text(app?["tagline"].string ?? "").leadStyle()
                    }
                }
                Text(app?["about"].string ?? "").font(Theme.Text.m)
                if app?["live"].bool == true {
                    if appId == "uniswap" {
                        SwapPanel(profile: profile) { phase = .confirm($0) }
                    } else {
                        AavePanel(profile: profile) { phase = .confirm($0) }
                    }
                    AppApproval(profile: profile, app: defiApp)
                } else if app != nil {
                    Notice("\(defiApp.name) is not available in Swissquote Wallet yet. Swissquote adds an app once it has checked it and built a safe way to use it.")
                }
            }
            .task { app = try? await core.call("apps.byId", appId) }
        }
    }
}

/// Prepares an app request in the core, for the confirmation card.
private struct PrepareButton: View {
    let enabled: Bool
    let request: () -> JSONValue
    let onReady: (AppUse) -> Void

    @Environment(WalletCore.self) private var core
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        if let error { Notice(.error, error) }
        Button(busy ? "Preparing…" : "Continue") {
            Task {
                busy = true
                error = nil
                defer { busy = false }
                do { onReady(AppUse(json: try await core.call("prepareAppUse", request()))) }
                catch { self.error = error.localizedDescription }
            }
        }
        .buttonStyle(.primary)
        .disabled(!enabled || busy)
    }
}

private struct SwapPanel: View {
    let profile: WalletProfile
    let onReady: (AppUse) -> Void

    @Environment(Session.self) private var session
    @Environment(WalletCore.self) private var core
    @State private var fromUsdc = true
    @State private var input = ""
    @State private var quote: String?
    @State private var minOut: String?
    @State private var have: (usdc: Units, eth: Units)?
    @State private var tokens: JSONValue?

    private var amountIn: String? { TokenAmount.units(input, decimals: fromUsdc ? 6 : 18) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Picker("Direction", selection: $fromUsdc) {
                Text("USDC → ETH").tag(true)
                Text("ETH → USDC").tag(false)
            }
            .pickerStyle(.segmented)
            AmountField(unit: fromUsdc ? "USDC" : "ETH", text: $input, label: "Amount of \(fromUsdc ? "USDC" : "ETH") to exchange")
            Text(haveText).smallMuted()
            Text(quoteText).font(.system(size: 18, weight: .semibold))
            PrepareButton(enabled: amountIn != nil && minOut != nil, request: {
                .object(["app": "uniswap", "tokenIn": tokens?[fromUsdc ? "usdc" : "weth"] ?? .null,
                         "amountIn": .string(amountIn ?? "0"), "minOut": .string(minOut ?? "0")])
            }, onReady: onReady)
        }
        .padding(16)
        .background(Theme.surface, in: .rect(cornerRadius: Theme.radiusCard))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Exchange")
        .task {
            tokens = try? await core.call("constants")
            let usdc = (try? await core.call("loadUsdcBalance", as: Units.self)) ?? .zero
            let eth = (try? await core.call("loadPositions")).map { Units($0["eth"]) } ?? .zero
            have = (usdc, eth)
        }
        .task(id: "\(fromUsdc)-\(input)") { await requote() }
    }

    private var haveText: String {
        var text = ""
        if let amountIn, let price = session.price {
            let chf = fromUsdc ? (Double(amountIn) ?? 0) / 1e6 * price.usdcChf : (Double(amountIn) ?? 0) / 1e18 * price.ethChf
            text = "About \(Format.chf(chf)) · "
        }
        return text + "You have \(have.map { fromUsdc ? Format.usdc($0.usdc) : Format.eth($0.eth) } ?? "…")"
    }

    private var quoteText: String {
        if let quote { return "You get about \(fromUsdc ? Format.eth(Units(JSONValue.string(quote))) : Format.usdc(Units(JSONValue.string(quote))))" }
        return amountIn == nil ? " " : "Asking Uniswap for a price…"
    }

    private func requote() async {
        quote = nil
        minOut = nil
        guard let amountIn, let tokenIn = tokens?[fromUsdc ? "usdc" : "weth"] else { return }
        try? await Task.sleep(for: .milliseconds(350))
        guard !Task.isCancelled, let quoted = try? await core.call("quoteSwap", tokenIn, amountIn).string else { return }
        quote = quoted
        minOut = try? await core.call("minimumOut", quoted).string
    }
}

private struct AavePanel: View {
    let profile: WalletProfile
    let onReady: (AppUse) -> Void

    @Environment(Session.self) private var session
    @Environment(WalletCore.self) private var core
    @Environment(Navigation.self) private var navigation
    @State private var deposit = true
    @State private var input = ""
    @State private var positions: (eth: String, ethInAave: String)?
    @State private var rate: Double?

    /// maxUint256: "withdraw everything", including interest earned meanwhile.
    private static let everything = "115792089237316195423570985008687907853269984665640564039457584007913129639935"

    private var amount: String? { TokenAmount.units(input, decimals: 18) }
    private var available: String? { positions.map { deposit ? $0.eth : $0.ethInAave } }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(spacing: 10) {
                DetailRow(label: "Earning now", value: rate.map { String(format: "%.2f%% a year", $0 * 100) } ?? "…")
                DetailRow(label: "Your ETH in Aave", value: positions.map { "\(Format.eth(Units(JSONValue.string($0.ethInAave)))) · \(chf($0.ethInAave))" } ?? "…")
                DetailRow(label: "ETH in your safe", value: positions.map { Format.eth(Units(JSONValue.string($0.eth))) } ?? "…")
            }
            Picker("Deposit or withdraw", selection: $deposit) {
                Text("Deposit").tag(true)
                Text("Withdraw").tag(false)
            }
            .pickerStyle(.segmented)
            AmountField(unit: "ETH", text: $input, label: "Amount of ETH to \(deposit ? "deposit" : "withdraw")")
            if let available, TokenAmount.compare(available, "0") > 0 {
                Button(deposit ? "Deposit all my ETH" : "Withdraw everything") { input = TokenAmount.decimal(available, decimals: 18) }
                    .buttonStyle(.quiet)
            }
            if let positions, positions.eth == "0", deposit {
                Text("You have no ETH yet. Exchange some USDC for ETH on Uniswap first.").smallMuted()
            }
            let tooMuch = amount.flatMap { a in available.map { TokenAmount.compare(a, $0) > 0 } } ?? false
            PrepareButton(enabled: amount != nil && !tooMuch, request: {
                let all = !deposit && amount != nil && available != nil && TokenAmount.compare(amount!, available!) >= 0
                return .object(["app": "aave", "action": .string(deposit ? "supply" : "withdraw"),
                                "amount": .string(all ? Self.everything : amount ?? "0")])
            }, onReady: onReady)
        }
        .padding(16)
        .background(Theme.surface, in: .rect(cornerRadius: Theme.radiusCard))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Earn")
        .task {
            if let value = try? await core.call("loadPositions") {
                positions = (value["eth"].string ?? "0", value["ethInAave"].string ?? "0")
            }
            rate = (try? await core.call("aaveEthRate"))?.number
        }
    }

    private func chf(_ wei: String) -> String {
        guard let price = session.price else { return "…" }
        return Format.chf((Double(wei) ?? 0) / 1e18 * price.ethChf)
    }
}

/// "Use with Face ID alone": adding the app to the client's rules, after the waiting period.
private struct AppApproval: View {
    let profile: WalletProfile
    let app: DefiApp

    @Environment(WalletCore.self) private var core
    @State private var approved: Bool?
    @State private var pending: JSONValue?
    @State private var supported: Bool?
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        Group {
            if approved == nil || supported == nil {
                // Something to show while loading: an empty view would never start its task.
                ProgressView().frame(maxWidth: .infinity)
            } else if supported == false {
                Text("Your safe was opened before apps were available: each use is checked by Swissquote.").smallMuted()
            } else if approved == true {
                Label("\(app.name) works with Face ID alone, within a daily limit. You can remove it in Rules.", systemImage: "checkmark.shield.fill")
                    .foregroundStyle(Theme.protect).font(.system(size: 17, weight: .semibold))
            } else if let pending, let until = pending["effectiveAt"].string.flatMap(RecoverView.date) {
                Notice(.warn) {
                    Countdown(until: until, prefix: "\(app.name) works with Face ID alone in ") { Task { await load() } }
                    Text("You can cancel it in Rules.")
                    DemoModeTag(production: "24 hours")
                }
            } else if approved == false {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Use \(app.name) with Face ID alone").font(.system(size: 18, weight: .bold))
                    Text("Today, Swissquote checks each use. Approve it in your rules and Face ID will be enough, within a daily limit. As with a new contact, it takes effect after a waiting period, and you are alerted.")
                        .smallMuted()
                    if let message { Notice(message) }
                    Button(busy ? "Waiting for Face ID…" : "Approve with Face ID") { Task { await approve() } }
                        .buttonStyle(.secondary).disabled(busy)
                }
                .padding(16)
                .background(Theme.surface, in: .rect(cornerRadius: Theme.radiusCard))
            }
        }
        .task { await load() }
    }

    private func load() async {
        approved = ((try? await core.call("loadRulebook", profile.walletId))?["apps"].array ?? []).contains(.string(app.id))
        pending = ((try? await core.call("cosigner.changes", profile.walletId))?.array ?? []).first {
            $0["status"].string == "pending" && $0["change"]["kind"].string == "addApp" && $0["change"]["appId"].string == app.id
        }
        supported = (try? await core.call("appsAvailable"))?.bool ?? false
    }

    private func approve() async {
        busy = true
        defer { busy = false }
        do {
            try await core.call("requestChange", JSONValue.object(["kind": "addApp", "appId": .string(app.id)]))
            await load()
        } catch {
            message = error.localizedDescription
        }
    }
}

/// An amount typed next to its unit.
private struct AmountField: View {
    let unit: String
    @Binding var text: String
    let label: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(unit).font(Theme.Text.l).foregroundStyle(Theme.inkSoft)
            TextField("0.00", text: $text)
                .font(Theme.Text.xl).monospacedDigit().keyboardType(.decimalPad)
                .accessibilityLabel(label)
        }
    }
}

/// Token amounts as exact decimal strings of base units (wei can exceed 64 bits), as viem's parseUnits.
enum TokenAmount {
    /// "0.5" with 18 decimals → "500000000000000000"; nil when it is not a positive amount.
    static func units(_ input: String, decimals: Int) -> String? {
        let text = input.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard (1...2).contains(parts.count), parts.allSatisfy({ $0.allSatisfy(\.isNumber) }), !text.isEmpty, text != "." else { return nil }
        let whole = String(parts[0]), fraction = parts.count == 2 ? String(parts[1]) : ""
        guard fraction.count <= decimals else { return nil }
        let digits = (whole + fraction + String(repeating: "0", count: decimals - fraction.count)).drop(while: { $0 == "0" })
        return digits.isEmpty ? nil : String(digits)
    }

    /// "500000000000000000" with 18 decimals → "0.5".
    static func decimal(_ units: String, decimals: Int) -> String {
        let padded = String(repeating: "0", count: max(0, decimals + 1 - units.count)) + units
        let whole = padded.dropLast(decimals), fraction = padded.suffix(decimals).replacing(/0+$/, with: "")
        return fraction.isEmpty ? String(whole) : "\(whole).\(fraction)"
    }

    /// Compares two non-negative integers written in decimal.
    static func compare(_ a: String, _ b: String) -> Int {
        let x = String(a.drop(while: { $0 == "0" })), y = String(b.drop(while: { $0 == "0" }))
        if x.count != y.count { return x.count < y.count ? -1 : 1 }
        return x == y ? 0 : (x < y ? -1 : 1)
    }
}
