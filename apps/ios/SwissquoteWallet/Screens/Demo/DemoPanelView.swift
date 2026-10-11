import SwiftUI

/// Demo panel (screen 9): the switches a presenter needs. Everything here is demo-only.
/// Mirrors apps/web/app/demo/page.tsx.
struct DemoPanelView: View {
    @Environment(Session.self) private var session
    @Environment(WalletCore.self) private var core
    @Environment(Navigation.self) private var navigation

    @State private var offline: Bool?
    @State private var recoverable: Bool?
    @State private var confirmLoss = false
    @State private var error: String?
    @State private var server = AppConfig.serverURL.absoluteString
    @State private var serverStatus: (ok: Bool, text: String)?

    /// The demo timers the services run with (.env: LOOSENING_DELAY_SECONDS, RECOVERY_WAIT_SECONDS).
    private static let looseningDelaySeconds = 30
    private static let recoveryWaitSeconds = 60

    var body: some View {
        Screen {
            HStack(spacing: 10) {
                Text("Demo panel").titleStyle()
                MockTag(text: "Demo")
            }
            RowsGroup {
                DemoRow(title: "Swissquote offline",
                        detail: "Stops Swissquote’s co-signer. Pocket payments still work; larger moves use your recovery key and the independent safe-keeper.") {
                    Button(offline == true ? "Bring back" : "Switch off") { Task { await toggleOffline() } }
                        .buttonStyle(.secondary).fixedSize().disabled(offline == nil)
                }
                if session.profile != nil {
                    DemoRow(title: "Attacker mode", detail: "A thief holds the unlocked phone and the client’s email. Watch what fails.") {
                        NavigationLink("Start", value: Route.attacker)
                            .buttonStyle(.secondary).fixedSize()
                    }
                    DemoRow(title: "Plan", detail: "Premium or Standard: who pays the network fees.") {
                        NavigationLink("Change", value: Route.settings)
                            .buttonStyle(.secondary).fixedSize()
                    }
                }
                DemoRow(title: "The client’s other device",
                        detail: "Swissquote e-banking, where alerts arrive and changes can be cancelled.") {
                    Link("Open", destination: AppConfig.webURL.appending(path: "e-banking"))
                        .buttonStyle(.secondary).fixedSize()
                }
                if session.profile == nil {
                    // The check opens a test safe and forgets it: only offered when this phone holds no safe.
                    DemoRow(title: "Wallet core check", detail: "Runs the wallet core’s end-to-end check on this phone (step 2 of the iOS plan).") {
                        NavigationLink("Run") { BridgeCheckView() }
                            .buttonStyle(.secondary).fixedSize()
                    }
                }
            }
            serverSection
            Notice {
                Text("Demo timers").bold()
                Text("New contacts and higher limits wait \(Self.looseningDelaySeconds) seconds instead of 24 hours. A recovery waits \(Self.recoveryWaitSeconds) seconds instead of 48 hours.")
                    .font(Theme.Text.s).foregroundStyle(Theme.inkSoft)
            }
            if session.profile != nil { losePhone }
            if let error { Notice(.error, error) }
        }
        .task {
            offline = (try? await core.call("cosigner.health"))?["offline"].bool ?? true
            if let walletId = session.profile?.walletId {
                recoverable = (try? await core.call("hasRecoveryKey", walletId))?.bool == true
            }
        }
    }

    /// The Mac's services: localhost in the Simulator, the Mac's https tunnel on an iPhone.
    private var serverSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Swissquote services").font(.geist(18, .semibold))
            Text("The Mac running pnpm dev. On an iPhone, its https tunnel address.").smallMuted()
            TextField("https://….trycloudflare.com", text: $server)
                .font(.geist(15.75)).foregroundStyle(Theme.inkSoft)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(12)
                .background(Theme.surfaceAlt, in: .rect(cornerRadius: Theme.radiusControl))
                .accessibilityLabel("Server address")
            HStack(spacing: 8) {
                Button("Use this address") { Task { await useServer(server) } }.buttonStyle(.secondary)
                Button("Built-in") { Task { await useServer(nil) } }.buttonStyle(.quiet).fixedSize()
            }
            if let serverStatus { Notice(serverStatus.ok ? .ok : .error, serverStatus.text) }
        }
        .card(padding: 16)
    }

    private func useServer(_ text: String?) async {
        if let text, AppConfig.validURL(text) == nil {
            serverStatus = (false, "This is not a web address. It starts with https://")
            return
        }
        AppConfig.setServerURL(text)
        server = AppConfig.serverURL.absoluteString
        do {
            let health = try await core.call("cosigner.health")
            offline = health["offline"].bool
            serverStatus = (true, "Swissquote answers at \(AppConfig.serverName).")
        } catch {
            serverStatus = (false, "No answer from \(AppConfig.serverName): \(error.localizedDescription)")
        }
        await session.reload()
    }

    private var losePhone: some View {
        Notice(.warn) {
            Text("Lose this phone").bold()
            Text("Deletes this phone’s piece of the key and its pocket key, as if the phone were lost. Then recover the safe with “I lost my phone”. You need your recovery key.")
                .font(Theme.Text.s)
            if recoverable == false {
                Text("This safe has no recovery key yet, so it could not be recovered. Add it first from the home screen.")
                    .font(Theme.Text.s).padding(.top, 6)
            } else if confirmLoss {
                Button("Yes, delete it from this phone") { Task { await forgetThisPhone() } }
                    .buttonStyle(.primary).padding(.top, 6)
            } else {
                Button("Lose this phone") { confirmLoss = true }
                    .buttonStyle(.secondary).padding(.top, 6).disabled(recoverable != true)
            }
        }
    }

    private func toggleOffline() async {
        guard let offline else { return }
        do {
            self.offline = try await core.call("cosigner.setOffline", !offline)["offline"].bool
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func forgetThisPhone() async {
        do {
            try await core.call("forgetThisPhone")
            navigation.reset()
            await session.reload()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct DemoRow<Action: View>: View {
    let title: String
    let detail: String
    @ViewBuilder let action: Action

    var body: some View {
        GroupRow(title: title, subtitle: detail) { action }
    }
}
