import SwiftUI

/// Attacker mode (CLAUDE.md section 8): the thief holds the unlocked phone AND the client's email. Each
/// attempt calls the real services; the screen shows each refusal and why, in plain language.
/// Mirrors apps/web/app/demo/attacker/page.tsx.
struct AttackerView: View {
    let profile: WalletProfile

    private enum Verdict { case refused, allowed, pending }
    private struct Outcome {
        let verdict: Verdict
        let lines: [String]
    }

    /// The thief's own test addresses (packages/shared/src/demo.ts).
    private static let thiefBtc = "tb1qc64spgn84q8x2mckcjn5l4lqtena67aqaedy2k"
    private static let thiefEth = "0xE2a0455E058a23E152C18f56103c99522554867f"

    @Environment(Session.self) private var session
    @Environment(WalletCore.self) private var core
    @State private var outcomes: [String: Outcome] = [:]
    @State private var busy: String?
    @State private var contactChange: JSONValue?
    @State private var maxLoss: Units?

    private var steps: [(id: String, title: String, run: () async throws -> Outcome)] {
        [
            ("send", "Send \(Format.chf(5_000)) to himself", trySend),
            ("contact", "Add himself as a contact", tryContact),
            ("limits", "Take whatever the rules allow", tryLimits),
            ("recovery", "Move the safe to his own phone", tryRecovery),
        ]
    }

    var body: some View {
        Screen {
            HStack(spacing: 10) {
                Text("Attacker mode").titleStyle()
                MockTag(text: "Demo")
            }
            Text("A thief has your unlocked phone and can read your email. Try what he would try. Every attempt goes to the real Swissquote and recovery services.")
                .leadStyle()
            Link("Open the client’s other device", destination: AppConfig.webURL.appending(path: "e-banking"))
                .font(.geist(18, .semibold))
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                VStack(alignment: .leading, spacing: 10) {
                    Text("\(index + 1). \(step.title)").font(.geist(18, .bold))
                    if let outcome = outcomes[step.id] {
                        outcomeView(outcome, step: step.id)
                    } else {
                        Button(busy == step.id ? "Trying…" : "Try it") { attempt(step.id, step.run) }
                            .buttonStyle(.secondary).disabled(busy != nil)
                    }
                }
                .card(padding: 16)
            }
            if let maxLoss {
                Text("Worst case for the client today: the Spending pocket, \(Format.chf(maxLoss, btcChf: session.price?.btcChf)).").smallMuted()
            }
        }
        .task(id: contactChange?["id"].string) { await followContact() }
    }

    private func outcomeView(_ outcome: Outcome, step: String) -> some View {
        Notice(outcome.verdict == .refused ? .ok : outcome.verdict == .pending ? .warn : .info) {
            Text(outcome.verdict == .refused ? "Stopped" : outcome.verdict == .pending ? "On hold" : "Allowed, within limits").bold()
            ForEach(outcome.lines, id: \.self) { Text($0) }
            if step == "contact", contactChange?["status"].string == "pending",
               let until = contactChange?["effectiveAt"].string.flatMap(RecoverView.date) {
                Countdown(until: until, prefix: "Takes effect in ").font(Theme.Text.s)
                Text("unless the client cancels.").font(Theme.Text.s)
            }
        }
    }

    private func attempt(_ id: String, _ run: @escaping () async throws -> Outcome) {
        Task {
            busy = id
            defer { busy = nil }
            do { outcomes[id] = try await run() }
            catch { outcomes[id] = Outcome(verdict: .refused, lines: [error.localizedDescription]) }
        }
    }

    // MARK: - Attempts

    private func trySend() async throws -> Outcome {
        guard let price = session.price else { throw CoreError(name: "NoPrice", message: "Waiting for the prices.") }
        async let btc = core.call("cosigner.shield", profile.walletId, Self.thiefBtc, Format.chfToSats(5_000, btcChf: price.btcChf), as: Review.self)
        async let usdc = core.call("cosigner.shieldUsdc", profile.walletId, Self.thiefEth, Format.usdcForChf(5_000, usdcChf: price.usdcChf), as: Review.self)
        let (b, u) = try await (btc, usdc)
        let stopped = b.verdict == "BLOCKED" && u.verdict == "BLOCKED"
        return Outcome(verdict: stopped ? .refused : .allowed,
                       lines: ["Swissquote: \(b.verdict) in bitcoin, \(u.verdict) in USDC."] + b.reasons)
    }

    private func tryContact() async throws -> Outcome {
        let thief: JSONValue = .object([
            "id": .string("attacker-\(String(Int(Date().timeIntervalSince1970 * 1000), radix: 36))"),
            "name": "Mr. Smith (the thief)",
            "btcAddress": .string(Self.thiefBtc),
            "ethAddress": .string(Self.thiefEth),
        ])
        let result = try await core.call("requestChange", JSONValue.object(["kind": "addContact", "contact": thief]))
        contactChange = try await core.call("cosigner.changes", profile.walletId).array.first { $0["id"] == result["id"] }
        return Outcome(verdict: .pending, lines: [
            "Swissquote accepted the request but holds it for 24 hours, and alerted the real client on every channel, including the email the thief can read.",
            "Now open the client's other device and cancel it.",
        ])
    }

    private func tryLimits() async throws -> Outcome {
        let pocket = Units(try await core.call("available")["pocket"])
        maxLoss = pocket
        return Outcome(verdict: .allowed, lines: [
            "He can spend the Spending pocket: at most \(Format.chf(pocket, btcChf: session.price?.btcChf)) today, never more than its size of \(Format.chf(100)).",
            "In USDC, he can only pay your approved contacts (your family), up to your daily limit of \(Format.chf(100)): your account on Base checks this itself.",
            "Everything else needs Swissquote's check, which stops new recipients and large amounts.",
        ])
    }

    private func tryRecovery() async throws -> Outcome {
        let started = try await core.call("provider.startRecovery", profile.walletId)
        guard let recoveryId = started["recovery"]["id"].string else { throw CoreError(name: "BadAnswer", message: "No recovery was started.") }
        // The thief has no recovery key (it is at the client's home) and is not the client in the face check.
        let attestation = try await core.call("faceCheck", profile.walletId, recoveryId, "no-match")
        let result = try await core.call("provider.verifyRecovery", recoveryId,
                                         JSONValue.object(["requestId": started["requestId"], "faceCheck": attestation]))
        return Outcome(verdict: result["status"].string == "refused" ? .refused : .allowed,
                       lines: result["reasons"].array.compactMap(\.string).nilIfEmpty ?? ["The recovery went through."])
    }

    /// Follows the thief's new contact: the real client cancels it from their other device.
    private func followContact() async {
        guard let id = contactChange?["id"], contactChange?["status"].string == "pending" else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(2))
            guard let latest = try? await core.call("cosigner.changes", profile.walletId).array.first(where: { $0["id"] == id }),
                  latest["status"].string != "pending" else { continue }
            contactChange = latest
            let cancelled = latest["status"].string == "cancelled"
            outcomes["contact"] = Outcome(verdict: cancelled ? .refused : .allowed, lines: [cancelled
                ? "The real client saw the alert and cancelled it from their other device. The thief is not a contact."
                : "Nobody cancelled in time, so the thief became a contact. In real life the client has 24 hours to react."])
            return
        }
    }
}

private extension Array {
    var nilIfEmpty: Self? { isEmpty ? nil : self }
}
