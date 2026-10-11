import SwiftUI

/// Plan (CLAUDE.md section 7), appearance and, for the demo, Swissquote's operational wallet.
/// Mirrors apps/web/app/settings/page.tsx.
struct SettingsView: View {
    let profile: WalletProfile

    @Environment(Session.self) private var session
    @Environment(WalletCore.self) private var core
    @AppStorage(Appearance.themeKey) private var theme = Appearance.Theme.system.rawValue
    @AppStorage(Appearance.paperKey) private var paper = Appearance.Paper.swissquote.rawValue
    @State private var plan: String?
    @State private var account: JSONValue?
    @State private var message: String?

    var body: some View {
        Screen {
            Text("Your plan").titleStyle()
            if let plan {
                PlanChoice(plan: Binding(get: { plan }, set: { choose($0) }))
            }
            if let message { Notice(message) }

            Text("Appearance").sectionStyle()
            Segmented(options: Appearance.Theme.allCases.map { ($0.rawValue, $0.label) }, selection: $theme, label: "Light or dark")
            Text("Background colour").smallMuted()
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                ForEach(Appearance.Paper.allCases, id: \.rawValue) { option in
                    let chosen = paper == option.rawValue
                    Button { paper = option.rawValue } label: {
                        VStack(spacing: 8) {
                            Circle().fill(option.color).frame(width: 36, height: 36)
                                .overlay(Circle().strokeBorder(Theme.line, lineWidth: 1))
                            Text(option.label).font(.geist(15.75, .semibold)).foregroundStyle(Theme.ink)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Theme.surface, in: .rect(cornerRadius: Theme.radiusCard))
                        .overlay(RoundedRectangle(cornerRadius: Theme.radiusCard).strokeBorder(chosen ? Theme.brand : .clear, lineWidth: 2))
                        .cardShadow()
                    }
                    .buttonStyle(.pressable)
                    .accessibilityAddTraits(chosen ? .isSelected : [])
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Background colour")

            if let account { demoAccount(account) }
        }
        .task {
            do { plan = try await core.call("cosigner.wallet", profile.walletId)["plan"].string }
            catch { message = error.localizedDescription }
            account = try? await core.call("cosigner.demoAccount")
        }
    }

    @ViewBuilder private func demoAccount(_ account: JSONValue) -> some View {
        let btcChf = session.price?.btcChf
        Notice {
            HStack { Text("Swissquote demo account").rowTitle(); MockTag() }
            Text("Pays network fees on the Premium plan (up to \(Format.chf(Units(account["dailyFeeCapSats"]), btcChf: btcChf)) per client per day) and plays your Swissquote account for transfers. It collects what the demo family receives, so test bitcoin keeps circulating.")
                .smallMuted()
            let waiting = Units(account["waiting"])
            Text("Ready: \(Format.chf(Units(account["ready"]), btcChf: btcChf))" + (waiting.value > 0 ? ", waiting for the network: \(Format.chf(waiting, btcChf: btcChf))" : ""))
                .monospacedDigit()
            Text(account["address"].string ?? "").font(.geist(15.75)).foregroundStyle(Theme.inkSoft).textSelection(.enabled)
            Text("Fund it with test bitcoin from a faucet, ideally well before a demo.").smallMuted()
            Button("Collect the demo family’s test coins now") { Task { await collect() } }
                .buttonStyle(.secondary).padding(.top, 6)
        }
        let base = account["base"]
        if !base.isNull {
            Notice {
                HStack { Text("Swissquote on Base").rowTitle(); MockTag() }
                Text("Relays USDC payments to the network (bundler), pays their gas from its deposit (paymaster), and plays your Swissquote account for USDC transfers.")
                    .smallMuted()
                DetailRow(label: "Test USDC", value: Format.usdc(Units(base["usdc"])))
                DetailRow(label: "Gas deposit", value: Format.eth(Units(base["paymasterDeposit"])))
                DetailRow(label: "Relay wallet", value: Format.eth(Units(base["eth"])))
                Text(base["address"].string ?? "").font(.geist(15.75)).foregroundStyle(Theme.inkSoft).textSelection(.enabled)
                Text("Get test USDC for this address at faucet.circle.com (network: Base Sepolia).").smallMuted()
            }
        }
    }

    private func choose(_ next: String) {
        plan = next
        Task {
            do {
                try await core.call("cosigner.setPlan", profile.walletId, next)
                message = next == "premium"
                    ? "Premium: Swissquote now pays your network fees, in bitcoin and in USDC."
                    : "Standard: you now pay the network fee of each payment (in USDC: a small USDC fee to Swissquote, never ETH)."
            } catch {
                message = error.localizedDescription
            }
        }
    }

    private func collect() async {
        do {
            let result = try await core.call("cosigner.demoCollect")
            let btc = result["txids"].array.count, usdc = result["usdcTxs"].array.count
            let parts = [btc > 0 ? "test bitcoin from \(btc)" : nil, usdc > 0 ? "test USDC from \(usdc)" : nil].compactMap { $0 }
            message = parts.isEmpty ? "The demo family has nothing confirmed to collect yet." : "Collected \(parts.joined(separator: " and ")) family wallet(s)."
            account = try? await core.call("cosigner.demoAccount")
        } catch {
            message = error.localizedDescription
        }
    }
}

/// Light, dark or like the phone, and the background colour (apps/web/lib/appearance.ts).
nonisolated enum Appearance {
    static let themeKey = "sqw.theme"
    static let paperKey = "sqw.paper"

    enum Theme: String, CaseIterable {
        case light, dark, system

        var label: String {
            switch self {
            case .light: "Light"
            case .dark: "Dark"
            case .system: "Like my phone"
            }
        }

        var colorScheme: ColorScheme? {
            switch self {
            case .light: .light
            case .dark: .dark
            case .system: nil
            }
        }
    }

    enum Paper: String, CaseIterable {
        case swissquote, sand, mint, rose, lavender, white

        var label: String { self == .white ? "Pure" : rawValue.capitalized }

        var hex: (light: UInt32, dark: UInt32) {
            switch self {
            case .swissquote: (0xeff3fa, 0x121417)
            case .sand: (0xf5efe6, 0x17140f)
            case .mint: (0xe9f4ee, 0x0f1714)
            case .rose: (0xfbeeee, 0x181012)
            case .lavender: (0xf0eefa, 0x13121a)
            case .white: (0xffffff, 0x050505)
            }
        }

        var color: Color { SwissquoteWallet.Theme.color(light: hex.light, dark: hex.dark) }
    }
}
