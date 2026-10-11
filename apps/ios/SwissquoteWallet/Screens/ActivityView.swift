import SwiftUI

/// Activity (screen 7): payments in and out of the safe, each with its explorer link.
/// Mirrors apps/web/app/activity/page.tsx.
struct ActivityView: View {
    @Environment(Session.self) private var session
    @Environment(WalletCore.self) private var core
    @State private var items: [JSONValue]?
    @State private var unavailable: [String] = []
    @State private var error: String?

    var body: some View {
        Screen(tabs: true) {
            Text("Activity").titleStyle()
            if let error { Notice(.error, error) }
            if !unavailable.isEmpty {
                Notice(.warn, "Your \(unavailable.joined(separator: " and ")) activity could not be loaded right now. Try again in a moment.")
            }
            if items?.isEmpty == true { Text("Nothing yet. Payments in and out of your safe will appear here.").leadStyle() }
            if items == nil && error == nil { ProgressView().frame(maxWidth: .infinity) }
            if let items, !items.isEmpty {
                RowsGroup {
                    ForEach(items.indices, id: \.self) { index in row(items[index]) }
                }
            }
            Text("Tap a payment to see it on its network.").smallMuted()
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func row(_ item: JSONValue) -> some View {
        let amount = Units(item["amount"]), fee = Units(item["fee"])
        let usdc = item["asset"].string == "USDC"
        var detail = usdc ? "USDC · " : "Bitcoin · "
        if item["confirmed"].bool == true {
            detail += item["time"].string.flatMap(RecoverView.date)?.formatted(.dateTime.day().month(.wide).hour().minute()) ?? "Confirmed"
        } else {
            detail += "On its way"
        }
        if fee.value > 0 { detail += ", network fee \(chf(fee, usdc: usdc))" }
        return Link(destination: URL(string: item["link"].string ?? "") ?? AppConfig.webURL) {
            GroupRow(title: item["label"].string ?? "", subtitle: detail) {
                Text((amount.value > 0 ? "+" : "") + chf(amount, usdc: usdc)).rowTitle().monospacedDigit().fixedSize()
            }
        }
        .buttonStyle(.plain)
    }

    private func chf(_ units: Units, usdc: Bool) -> String {
        guard let price = session.price else { return "…" }
        return Format.chf(usdc ? Format.usdcChf(units, usdcChf: price.usdcChf) : Format.satsToChf(units, btcChf: price.btcChf))
    }

    private func load() async {
        do {
            let activity = try await core.call("loadActivity")
            items = activity["items"].array
            unavailable = activity["unavailable"].array.compactMap(\.string)
            error = nil
        } catch {
            self.error = "Your activity could not be loaded. Try again in a moment."
        }
    }
}

/// Alerts from Swissquote's Watcher (screen 7), with the changes and recoveries the client can cancel.
/// Mirrors apps/web/app/alerts/page.tsx and components/alerts-feed.tsx; refreshes every few seconds.
struct AlertsView: View {
    let profile: WalletProfile

    @Environment(WalletCore.self) private var core
    @State private var alerts: [JSONValue] = []
    @State private var pending: [JSONValue] = []
    @State private var recovery: JSONValue?
    @State private var contacts: [Contact] = []
    @State private var error: String?

    var body: some View {
        Screen {
            Text("Alerts").titleStyle()
            Text("Swissquote tells you about every important change to your safe, on every channel.").leadStyle()
            if let error { Notice(.error, error) }
            if let recovery, !recovery.isNull { recoveryCard(recovery) }
            ForEach(pending.indices, id: \.self) { index in pendingCard(pending[index]) }
            RowsGroup {
                if alerts.isEmpty { Text("No alerts yet.").foregroundStyle(Theme.inkSoft).padding(.vertical, 18) }
                ForEach(alerts.indices, id: \.self) { index in
                    let alert = alerts[index]
                    VStack(alignment: .leading, spacing: 2) {
                        Text(alert["message"].string ?? "").font(Theme.Text.m)
                        if let at = alert["at"].string.flatMap(RecoverView.date) {
                            Text(at.formatted(date: .omitted, time: .standard)).smallMuted()
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 18)
                    .accessibilityElement(children: .combine)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Alerts")
        }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    private func recoveryCard(_ recovery: JSONValue) -> some View {
        Notice(.warn) {
            Text("Your safe is being moved to a new phone").bold()
            if recovery["status"].string == "waiting-period", let until = recovery["waitUntil"].string.flatMap(RecoverView.date) {
                Countdown(until: until, prefix: "It happens in ")
                DemoModeTag(production: "48 hours")
            } else {
                Text("Someone started it and is being checked.")
            }
            Text("If this is not you, cancel it now.").font(Theme.Text.s)
            Button("This is not me: cancel") {
                Task {
                    _ = try? await core.call("provider.cancelRecovery", recovery["id"])
                    await load()
                }
            }
            .buttonStyle(.primary).padding(.top, 6)
        }
    }

    private func pendingCard(_ change: JSONValue) -> some View {
        Notice(.warn) {
            Text(describe(change["change"])).bold()
            if let until = change["effectiveAt"].string.flatMap(RecoverView.date) {
                Countdown(until: until, prefix: "Takes effect in ") { Task { await load() } }
                DemoModeTag(production: "24 hours")
            }
            Text("If you did not ask for this, cancel it now.").font(Theme.Text.s)
            Button("Cancel this change") {
                Task {
                    _ = try? await core.call("cosigner.cancelChange", profile.walletId, change["id"])
                    await load()
                }
            }
            .buttonStyle(.primary).padding(.top, 6)
        }
    }

    private func describe(_ change: JSONValue) -> String {
        switch change["kind"].string {
        case "addContact": "Add \(change["contact"]["name"].string ?? "someone") as a contact"
        case "removeContact": "Remove \(contacts.first { $0.id == change["contactId"].string }?.name ?? "a contact")"
        case "setDailyLimit": "Daily limit to \(Format.chf(change["dailyLimitChf"].number ?? 0))"
        case "setPocketSize": "Spending pocket size to \(Format.chf(change["pocketSizeChf"].number ?? 0))"
        case "freeze": "Freeze the safe"
        case "unfreeze": "Unfreeze the safe"
        case "addApp": "Use \(RulesView.appNames[change["appId"].string ?? ""] ?? "an app") with Face ID alone"
        default: "Stop \(RulesView.appNames[change["appId"].string ?? ""] ?? "an app") from being used with Face ID alone"
        }
    }

    private func load() async {
        do {
            async let alertsTask = core.call("cosigner.alerts", profile.walletId)
            async let changesTask = core.call("cosigner.changes", profile.walletId)
            async let rulebookTask = core.call("cosigner.rulebook", profile.walletId)
            alerts = try await alertsTask.array
            pending = try await changesTask.array.filter { $0["status"].string == "pending" }
            contacts = try await rulebookTask["contacts"].array.map(Contact.init(json:))
            recovery = try? await core.call("provider.activeRecovery", profile.walletId)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
