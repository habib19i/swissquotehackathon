import SwiftUI

/// "I lost my phone" (screen 8, CLAUDE.md section 8), on the new phone: log in, a new Face ID key, the
/// recovery key, the face check (Mock), the waiting period, then the MPC refresh that gives this phone a
/// new key piece. Mirrors apps/web/app/recover/page.tsx.
struct RecoverView: View {
    private enum Step { case identify, faceId, recoveryKey, faceCheck, refused, waiting, cancelled, restoring, done }

    @Environment(Session.self) private var session
    @Environment(WalletCore.self) private var core
    @Environment(\.dismiss) private var dismiss

    @State private var step = Step.identify
    @State private var error: String?
    @State private var clientNumber = Client.demo.clientNumber
    /// Swissquote's record of the safe being recovered.
    @State private var record: JSONValue?
    @State private var passkey: JSONValue?
    /// The recovery request, the recovery key's assertion, waiting for the face check.
    @State private var pending: JSONValue?
    @State private var recovery: JSONValue?
    @State private var ready = false
    @State private var scanning = false
    @State private var result: JSONValue?

    private var client: Client {
        Client(name: session.client?.name ?? Client.demo.name, clientNumber: clientNumber.trimmingCharacters(in: .whitespaces))
    }

    var body: some View {
        content
            .navigationBarBackButtonHidden(step != .identify)
            .onAppear { if let number = session.client?.clientNumber { clientNumber = number } }
            .task(id: step) { if step == .waiting { await followRecovery() } }
    }

    @ViewBuilder private var content: some View {
        switch step {
        case .identify:
            Screen {
                Text("Bring your safe to this phone").titleStyle()
                Text("Lost or stolen phone? Your safe is not lost. First, log in to your Swissquote account on this new phone.").leadStyle()
                VStack(alignment: .leading, spacing: 8) {
                    Text("Client number").font(.geist(18, .semibold))
                    ClientNumberField(text: $clientNumber)
                }
                MockNote("The Swissquote login is simulated.")
                errorNotice
            } actions: {
                Button("Continue") { attempt(identify) }.buttonStyle(.primary)
            }

        case .faceId:
            Screen {
                Text("Lock this phone with your face").titleStyle()
                Text("This new phone gets its own Face ID key. Your old phone’s key will stop working.").leadStyle()
                errorNotice
            } actions: {
                Button { attempt(newFaceId) } label: { FaceIdLabel("Use Face ID") }.buttonStyle(.primary)
            }

        case .recoveryKey:
            Screen {
                Text("Show your recovery key").titleStyle()
                Text("The security key Swissquote sent you, or the passkey you chose as your recovery key. Only you have it, so only you can move your safe.").leadStyle()
                errorNotice
            } actions: {
                Button("Use my recovery key") { attempt(presentKey) }.buttonStyle(.primary)
            }

        case .faceCheck:
            Screen {
                Text("A quick face check").titleStyle()
                Text("Swissquote compares your face with the photo from when you opened your account.").leadStyle()
                FaceScan(scanning: scanning)
                MockNote("The face check is simulated in this prototype; Swissquote signs its result for the recovery provider.")
                errorNotice
            } actions: {
                Button(scanning ? "Checking…" : "Start the face check") { attempt(runFaceCheck) }
                    .buttonStyle(.primary).disabled(scanning)
            }

        case .refused:
            Screen {
                Text("Recovery refused").titleStyle()
                Notice(.error) { ForEach(recovery?["reasons"].array.compactMap(\.string) ?? [], id: \.self) { Text($0) } }
                Text("The client was alerted on every channel.").leadStyle()
            } actions: {
                Button("Back") { dismiss() }.buttonStyle(.primary)
            }

        case .waiting, .restoring:
            let restoring = step == .restoring
            Screen {
                Text(restoring ? "Bringing your safe back" : "Your safe is on its way").titleStyle()
                if !restoring, let until = recovery?["waitUntil"].string.flatMap(Self.date) {
                    VStack(alignment: .leading, spacing: 8) {
                        Countdown(until: until, prefix: "For your protection, your safe moves in ") { ready = true }
                            .leadStyle()
                        DemoModeTag(production: "48 hours")
                    }
                }
                if !restoring {
                    Notice {
                        IconLabel("Swissquote alerted you on every channel. If this was not you, you can cancel from any device.", icon: "shield")
                    }
                } else {
                    KeyHolders(ready: [false, true, true])
                    Text(restoreProgress).leadStyle()
                }
                errorNotice
            } actions: {
                if !restoring {
                    Button(ready ? "Bring my safe back" : "Waiting…") { Task { await restore() } }
                        .buttonStyle(.primary).disabled(!ready)
                }
            }

        case .cancelled:
            Screen {
                Text("Recovery cancelled").titleStyle()
                Text("Someone cancelled this recovery from another device. Your safe stays where it was.").leadStyle()
            } actions: {
                Button("Back") { dismiss() }.buttonStyle(.primary)
            }

        case .done:
            Screen {
                Text("Your safe is back").titleStyle()
                KeyHolders(ready: [true, true, true])
                Text("This phone now holds your piece of the key. Your old phone’s piece no longer works, and your bitcoin never moved.").leadStyle()
                if let txid = result?["sweepTxid"].string {
                    Notice(.ok) {
                        Text("Your old Spending pocket is moving to this phone’s new pocket.")
                        ExplorerLink(label: "View \(Format.shortId(txid)) on the Bitcoin network", url: Explorer.btcTx(txid))
                    }
                }
                if let failure = result?["sweepError"].string { Notice("Your old Spending pocket could not be moved yet: \(failure)") }
                if let hash = result?["baseTxHash"].string {
                    Notice(.ok) {
                        Text("Your USDC now answer to this phone’s Face ID. The lost phone’s Face ID no longer works.")
                        ExplorerLink(label: "View \(Format.shortId(hash)) on Base", url: Explorer.baseTx(hash))
                    }
                }
                if let failure = result?["baseError"].string {
                    Notice("Your USDC could not be switched to this phone yet: \(failure). You can retry from your home screen.")
                }
            } actions: {
                Button("Go to my safe") { Task { await session.reload() } }.buttonStyle(.primary)
            }
        }
    }

    @ViewBuilder private var errorNotice: some View {
        if let error { Notice(.error, error) }
    }

    private var restoreProgress: String {
        let base = "Swissquote and the independent safe-keeper are making a new piece for this phone"
        guard let progress = core.progress, progress.event == "recovery-progress", progress.round > 0 else { return base + "…" }
        return base + ": step \(progress.round) of \(progress.total)…"
    }

    // MARK: - Steps

    private func attempt(_ action: @escaping () async throws -> Void) {
        Task {
            error = nil
            do { try await action() } catch {
                self.error = error.localizedDescription == "cancelled" ? "You cancelled. Try again when you are ready." : error.localizedDescription
            }
        }
    }

    private func identify() async throws {
        record = try await core.call("cosigner.walletOfClient", client.clientNumber)
        try await core.call("client.save", client)
        step = .faceId
    }

    private func newFaceId() async throws {
        passkey = try await core.call("setUpFaceId", client)
        step = .recoveryKey
    }

    private func presentKey() async throws {
        guard let walletId = record?["walletId"].string else { return }
        pending = try await core.call("beginRecovery", walletId)
        step = .faceCheck
    }

    private func runFaceCheck() async throws {
        guard let walletId = record?["walletId"].string, let pending, let recoveryId = pending["recovery"]["id"].string else { return }
        scanning = true
        defer { scanning = false }
        // MOCK: a real liveness check compares the client's face with their KYC photo at Swissquote.
        try await Task.sleep(for: .seconds(2.5))
        let attestation = try await core.call("faceCheck", walletId, recoveryId, "match")
        let verified = try await core.call("verifyRecovery", recoveryId, pending["requestId"], pending["assertion"], attestation)
        recovery = verified
        ready = Self.isReady(verified)
        step = verified["status"].string == "waiting-period" ? .waiting : .refused
    }

    /// During the waiting period, follow the provider: the real client may cancel from another device.
    private func followRecovery() async {
        while !Task.isCancelled, step == .waiting, let id = recovery?["id"].string {
            try? await Task.sleep(for: .seconds(2))
            guard let latest = try? await core.call("provider.recovery", id) else { continue }
            recovery = latest
            if Self.isReady(latest) { ready = true }
            if latest["status"].string == "cancelled" { step = .cancelled }
        }
    }

    private func restore() async {
        guard let record, let passkey, let recoveryId = recovery?["id"].string else { return }
        error = nil
        step = .restoring
        do {
            result = try await core.call("completeRecovery", client, record, recoveryId, passkey)
            step = .done
        } catch {
            self.error = error.localizedDescription
            step = .waiting
        }
    }

    private static func isReady(_ recovery: JSONValue) -> Bool {
        recovery["ready"].bool == true || (recovery["waitUntil"].string.flatMap(date).map { $0 <= .now } ?? false)
    }

    /// The services send ISO 8601 dates, with milliseconds.
    static func date(_ iso: String) -> Date? {
        if let date = try? Date(iso, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true)) { return date }
        return try? Date(iso, strategy: .iso8601)
    }
}

/// The face check's circle (`.face-scan`): the face icon in a green ring that pulses.
private struct FaceScan: View {
    let scanning: Bool
    @State private var pulse = false

    var body: some View {
        Icon("face", size: 72)
            .foregroundStyle(Theme.ink)
            .frame(width: 180, height: 180)
            .background(Theme.surface, in: .circle)
            .overlay(Circle().strokeBorder(Theme.protect, lineWidth: 3))
            .background(Circle().fill(Theme.protectBg).padding(pulse ? -10 : 0))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .onAppear { withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) { pulse = true } }
            .accessibilityHidden(true)
    }
}
