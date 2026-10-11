import SwiftUI

/// The rulebook (screen 6). Loosening changes (a new contact, a higher limit) wait 24 hours (demo: 30 s)
/// and can be cancelled; tightening changes are instant. Swissquote enforces this, not the app. Rules in
/// force are then written to the client's account on Base. Mirrors apps/web/app/rules/page.tsx.
struct RulesView: View {
    let profile: WalletProfile

    @Environment(WalletCore.self) private var core
    @Environment(Navigation.self) private var navigation
    @State private var rulebook: JSONValue?
    @State private var pending: [JSONValue] = []
    @State private var onBase: JSONValue?
    @State private var busy = false
    @State private var message: (ok: Bool, text: String, base: JSONValue?)?
    @State private var loadError: String?

    @State private var adding = false
    @State private var name = ""
    @State private var btcAddress = ""
    @State private var usdcAddress = ""
    /// Swissquote's checks of the contact being added, shown before Face ID.
    @State private var screening: JSONValue?

    @State private var editing: Limit?
    @State private var amount = ""

    enum Limit { case daily, pocket }

    static let appNames = ["uniswap": "Uniswap", "aave": "Aave"]

    var body: some View {
        Screen(tabs: true) {
            Text("Contacts and rules").titleStyle()
            Text("Making your rules stricter is instant. Loosening them takes 24 hours, so you can stop anything you did not ask for.")
                .leadStyle()
            DemoModeTag(production: "24 hours, not 30 seconds,")
            if let loadError { Notice(.error, loadError) }
            if let message {
                Notice(message.ok ? .ok : .error) {
                    Text(message.text)
                    BaseUpdate(base: message.base)
                }
            }
            if let rulebook {
                baseNotice
                ForEach(pending.indices, id: \.self) { index in pendingCard(pending[index]) }
                contacts(rulebook)
                apps(rulebook)
                limits(rulebook)
                if rulebook["frozen"].bool == true {
                    Button("Unfreeze my safe") { change(["kind": "unfreeze"], "Requested: your safe unfreezes after the waiting period.") }
                        .buttonStyle(.secondary).disabled(busy)
                } else {
                    Button("Freeze my safe") { change(["kind": "freeze"], "Done: your safe is frozen. No payment can leave the Savings safe.") }
                        .buttonStyle(.secondary).disabled(busy)
                }
            } else if loadError == nil {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .onAppear(perform: takeContactToAdd)
        .onChange(of: navigation.contactToAdd) { takeContactToAdd() }
    }

    /// "Add Marc as a contact" from the assistant: the form opens with the name; the address is typed here.
    private func takeContactToAdd() {
        guard let name = navigation.contactToAdd else { return }
        navigation.contactToAdd = nil
        self.name = String(name.prefix(40))
        screening = nil
        adding = true
    }

    // MARK: - Sections

    @ViewBuilder private var baseNotice: some View {
        if let onBase, onBase["rulesUpToDate"].bool == false, pending.isEmpty {
            Notice(.warn) {
                Text("New rules to write on Base").bold()
                Text("Your USDC account still follows your previous rules. Confirm with Face ID to bring it up to date.")
                Button(busy ? "Waiting for Face ID…" : "Update with Face ID") { writeOnBase() }
                    .buttonStyle(.primary).disabled(busy).padding(.top, 6)
            }
        }
    }

    private func pendingCard(_ change: JSONValue) -> some View {
        Notice(.warn) {
            Text(Self.title(of: change["change"])).bold()
            if let until = change["effectiveAt"].string.flatMap(RecoverView.date) {
                Countdown(until: until, prefix: "Takes effect in ") { Task { await load() } }
            }
            Button("Cancel") {
                Task {
                    _ = try? await core.call("cosigner.cancelChange", profile.walletId, change["id"])
                    await load()
                }
            }
            .buttonStyle(.secondary).padding(.top, 6)
        }
    }

    private func contacts(_ rulebook: JSONValue) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Your contacts").sectionStyle()
            RowsGroup {
                ForEach(rulebook["contacts"].array.map(Contact.init(json:))) { contact in
                    GroupRow(title: contact.name, subtitle: contact.relation.isEmpty ? "Contact" : contact.relation) {
                        Avatar(text: String(contact.name.prefix(1)))
                    } trailing: {
                        Button("Remove") {
                            change(["kind": "removeContact", "contactId": .string(contact.id)], "Done: \(contact.name) is no longer a contact.")
                        }
                        .buttonStyle(.quietInline).disabled(busy)
                        .accessibilityLabel("Remove \(contact.name)")
                    }
                }
            }
            if adding { addContactForm } else {
                Button("Add a contact") { adding = true }.buttonStyle(.secondary)
            }
        }
    }

    private var addContactForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            LabeledField(label: "Name", text: $name, onEdit: { screening = nil })
            LabeledField(label: "Their Bitcoin address", text: $btcAddress, monospaced: true, onEdit: { screening = nil })
            LabeledField(label: "Their USDC address", text: $usdcAddress, placeholder: "0x…", monospaced: true, onEdit: { screening = nil })
            Text("Give at least one.").smallMuted()
            if let screening { ScreeningCard(screening: screening) }
            let blocked = screening?["verdict"].string == "BLOCKED"
            Button(busy ? "Waiting for Face ID…" : screening == nil ? "Check with Swissquote"
                   : blocked ? "Swissquote cannot add this contact" : "Add with Face ID") { submitContact() }
                .buttonStyle(.primary)
                .disabled(busy || blocked || name.trimmingCharacters(in: .whitespaces).isEmpty
                          || (btcAddress.trimmingCharacters(in: .whitespaces).isEmpty && usdcAddress.trimmingCharacters(in: .whitespaces).isEmpty))
            Button("Cancel") {
                adding = false
                screening = nil
            }
            .buttonStyle(.quiet)
        }
        .card(padding: 16)
    }

    private func apps(_ rulebook: JSONValue) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Approved apps").sectionStyle()
            let ids = rulebook["apps"].array.compactMap(\.string)
            RowsGroup {
                if ids.isEmpty {
                    Text("None yet. In Explore, approve an app to use it with Face ID alone, within a daily limit.")
                        .smallMuted().padding(.vertical, 18)
                }
                ForEach(ids, id: \.self) { id in
                    let name = Self.appNames[id] ?? id
                    GroupRow(title: name, subtitle: "Face ID alone, within a daily limit") {
                        AppLogo(id: id, size: 40)
                    } trailing: {
                        Button("Remove") {
                            change(["kind": "removeApp", "appId": .string(id)], "Done: \(name) now needs Swissquote's check again.")
                        }
                        .buttonStyle(.quietInline).disabled(busy)
                        .accessibilityLabel("Remove \(name)")
                    }
                }
            }
        }
    }

    private func limits(_ rulebook: JSONValue) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Your limits").sectionStyle()
            RowsGroup {
                limitRow("Daily limit", "Face ID alone pays your contacts up to this each day; above it, Swissquote asks you to confirm",
                         value: rulebook["dailyLimitChf"].number ?? 0, limit: .daily)
                limitRow("Spending pocket size", "What your phone can spend on its own",
                         value: rulebook["pocketSizeChf"].number ?? 0, limit: .pocket)
            }
            if let editing {
                VStack(alignment: .leading, spacing: 16) {
                    AmountEntry(unit: "CHF", text: $amount,
                                label: editing == .daily ? "New daily limit in Swiss francs" : "New Spending pocket size in Swiss francs",
                                placeholder: "0")
                    Button(busy ? "Waiting for Face ID…" : "Save with Face ID") { saveLimit(rulebook) }
                        .buttonStyle(.primary).disabled(busy)
                    Button("Cancel") { self.editing = nil }.buttonStyle(.quiet)
                }
                .card(padding: 16)
            }
        }
    }

    private func limitRow(_ title: String, _ detail: String, value: Double, limit: Limit) -> some View {
        GroupRow(title: title, subtitle: detail) {
            Button(Format.chf(value)) {
                editing = limit
                amount = String(format: "%g", value)
            }
            .buttonStyle(.quietInline).disabled(busy)
            .accessibilityLabel("\(title): \(Format.chf(value)). Change")
        }
    }

    // MARK: - Actions

    private func load() async {
        do {
            rulebook = try await core.call("loadRulebook", profile.walletId)
            loadError = nil
        } catch {
            loadError = "Your rules could not be loaded: \(error.localizedDescription)"
        }
        pending = ((try? await core.call("cosigner.changes", profile.walletId))?.array ?? []).filter { $0["status"].string == "pending" }
        let hasUsdc = (try? await core.call("usdcAccount")) != nil
        onBase = hasUsdc ? try? await core.call("cosigner.ethStatus", profile.walletId) : nil
    }

    private func change(_ change: [String: JSONValue], _ done: String) {
        Task {
            busy = true
            message = nil
            defer { busy = false }
            do {
                let result = try await core.call("requestChange", JSONValue.object(change))
                message = (true, done, result["base"])
                adding = false
                screening = nil
                editing = nil
                await load()
            } catch {
                message = (false, error.localizedDescription == "cancelled" ? "Face ID was cancelled. Nothing changed." : error.localizedDescription, nil)
            }
        }
    }

    private func submitContact() {
        let trimmedName = name.trimmingCharacters(in: .whitespaces)
        let slug = trimmedName.lowercased().map { $0.isLetter || $0.isNumber ? String($0) : "-" }.joined()
        var contact: [String: JSONValue] = [
            "id": .string("\(slug)-\(String(Int(Date().timeIntervalSince1970 * 1000), radix: 36))"),
            "name": .string(trimmedName),
        ]
        let btc = btcAddress.trimmingCharacters(in: .whitespaces), usdc = usdcAddress.trimmingCharacters(in: .whitespaces)
        if !btc.isEmpty { contact["btcAddress"] = .string(btc) }
        if !usdc.isEmpty { contact["ethAddress"] = .string(usdc) }

        guard screening != nil else {
            Task {
                do { screening = try await core.call("cosigner.shieldContact", profile.walletId, JSONValue.object(contact)) }
                catch { message = (false, error.localizedDescription, nil) }
            }
            return
        }
        change(["kind": "addContact", "contact": .object(contact)],
               "Requested: \(trimmedName) becomes a contact after the waiting period, once Swissquote has checked the address.")
    }

    private func saveLimit(_ rulebook: JSONValue) {
        guard let editing, let chf = Format.parseChf(amount), chf > 0 else { return }
        let daily = editing == .daily
        let current = (daily ? rulebook["dailyLimitChf"] : rulebook["pocketSizeChf"]).number ?? 0
        let label = daily ? "your daily limit" : "your Spending pocket size"
        change(daily ? ["kind": "setDailyLimit", "dailyLimitChf": .number(chf)] : ["kind": "setPocketSize", "pocketSizeChf": .number(chf)],
               chf > current ? "Requested: \(label) becomes \(Format.chf(chf)) after the waiting period." : "Done: \(label) is now \(Format.chf(chf)).")
    }

    private func writeOnBase() {
        Task {
            busy = true
            message = nil
            defer { busy = false }
            do {
                let sent = try await core.call("updateRulesOnBase")
                message = (true, "Your rules are now written on Base.", sent)
                await load()
            } catch {
                message = (false, error.localizedDescription, nil)
            }
        }
    }

    /// A pending change in plain language.
    static func title(of change: JSONValue) -> String {
        switch change["kind"].string {
        case "addContact": "Adding \(change["contact"]["name"].string ?? "a contact")"
        case "setDailyLimit": "Daily limit to \(Format.chf(change["dailyLimitChf"].number ?? 0))"
        case "setPocketSize": "Pocket size to \(Format.chf(change["pocketSizeChf"].number ?? 0))"
        case "addApp": "\(appNames[change["appId"].string ?? ""] ?? "An app") with Face ID alone"
        default: "Unfreezing your safe"
        }
    }
}

/// The outcome of writing the rules on Base, under a change's message.
private struct BaseUpdate: View {
    let base: JSONValue?

    var body: some View {
        if let base, let error = base["error"].string {
            Text("Your rules on Base could not be updated yet: \(error)").font(Theme.Text.s)
        } else if let hash = base?["txHash"].string {
            ExplorerLink(label: "Also written on Base: \(Format.shortId(hash))", url: Explorer.baseTx(hash))
        }
    }
}

/// The scam shield's checks of a new contact, in plain language (CLAUDE.md section 9).
struct ScreeningCard: View {
    let screening: JSONValue

    var body: some View {
        let blocked = screening["verdict"].string == "BLOCKED"
        Notice(blocked ? .error : .warn) {
            IconLabel(blocked ? "Stopped by Swissquote" : "Checked by Swissquote", icon: "shield")
                .font(.geist(18, .semibold))
            ForEach(screening["checks"].array.indices, id: \.self) { index in
                let check = screening["checks"][index]
                let result = check["result"].string
                HStack(alignment: .top, spacing: 8) {
                    Group {
                        if result == "pass" { Icon("check", size: 18).foregroundStyle(Theme.protect).padding(.top, 3) }
                        else { Text(result == "fail" ? "✕" : "!").bold().foregroundStyle(result == "fail" ? Theme.danger : Theme.ink) }
                    }
                    .frame(width: 22, alignment: .leading)
                    .accessibilityHidden(true)
                    (Text("\(check["label"].string ?? "").").bold() + Text(" \(check["detail"].string ?? "")"))
                        .foregroundStyle(Theme.ink)
                }
            }
        }
    }
}

/// A labelled text field in the app's style.
struct LabeledField: View {
    let label: String
    @Binding var text: String
    var placeholder = ""
    var monospaced = false
    var onEdit: () -> Void = {}

    /// `.field`: the label in semibold, then the web's `.input`.
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.geist(18, .semibold))
            InputField(placeholder: placeholder, text: $text, monospaced: monospaced, label: label)
                .textInputAutocapitalization(monospaced ? .never : .words)
                .autocorrectionDisabled(monospaced)
                .onChange(of: text) { onEdit() }
        }
    }
}
