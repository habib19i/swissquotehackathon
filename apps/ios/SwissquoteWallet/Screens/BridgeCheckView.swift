import SwiftUI

/// Step 2's check (docs/ios-plan.md), run in the app itself: the core loads, Face ID creates the Secure
/// Enclave key, the 2-of-3 MPC key is generated with the services on the Mac, Swissquote verifies the
/// ownership proofs, the vault opens with Face ID, and "Lose this phone" forgets everything.
///
/// It opens a test safe and forgets it at the end, so it only runs on a phone without a safe; the Mock login
/// is put back afterwards. Launch with `-bridgeCheck` to run it at start; each result is also printed as
/// `CHECK ok|FAIL …`.
struct BridgeCheckView: View {
    @Environment(WalletCore.self) private var core
    @Environment(Session.self) private var session
    @State private var lines: [(ok: Bool, text: String)] = []
    @State private var running = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Swissquote Wallet — hackathon prototype").font(Theme.Text.s).foregroundStyle(Theme.inkSoft)
                Text("Wallet core check").font(Theme.Text.xl).foregroundStyle(Theme.ink)
                Text(status).font(Theme.Text.m).foregroundStyle(Theme.inkSoft)
                if !FaceIdKey.enforcedBySecureEnclave {
                    Text("Simulator: Face ID is checked by the app; on an iPhone the Secure Enclave enforces it.")
                        .font(Theme.Text.s).foregroundStyle(Theme.warn)
                        .padding(12).background(Theme.warnBg, in: .rect(cornerRadius: Theme.radiusControl))
                }
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    Label(line.text, systemImage: line.ok ? "checkmark.circle.fill" : "xmark.octagon.fill")
                        .font(Theme.Text.s)
                        .foregroundStyle(line.ok ? Theme.protect : Theme.danger)
                }
                if let progress = core.progress, running {
                    ProgressView(value: Double(progress.round), total: Double(max(progress.total, 1))) {
                        Text("Creating your key with Swissquote and the recovery provider…").font(Theme.Text.s)
                    }
                }
                Button(running ? "Checking…" : "Run the check") { Task { await run() } }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(running)
            }
            .padding(Theme.gutter)
        }
        .background(Theme.paper)
        .task {
            if ProcessInfo.processInfo.arguments.contains("-bridgeCheck") { await run() }
        }
    }

    private var status: String {
        switch core.state {
        case .loading: "Loading the wallet core…"
        case .ready(let methods): "Wallet core loaded: \(methods.count) methods. Services at \(AppConfig.serverName)."
        case .failed(let reason): reason
        }
    }

    private func check(_ ok: Bool, _ text: String) {
        lines.append((ok, text))
        print("CHECK \(ok ? "ok  " : "FAIL") \(text)")
    }

    private func run() async {
        running = true
        lines = []
        let login = try? await core.call("client.load")
        defer {
            Task {
                if let login, !login.isNull { _ = try? await core.call("client.save", login) } else { _ = try? await core.call("client.logout") }
                await session.reload()
                running = false
                print("CHECK done")
            }
        }
        do {
            try await core.ready()
            guard try await core.call("profile.load").isNull else {
                return check(false, "This phone holds a safe: the check would replace it. Run it on a phone without a safe.")
            }
            if case .ready(let methods) = core.state { check(methods.count > 40, "core loaded, \(methods.count) methods") }

            check(await core.isSecureContext(), "the core runs in a secure context (WebCrypto available)")

            let client: JSONValue = .object(["name": .string("Test Client"),
                                             "clientNumber": .string("CH-TEST-ios\(String(Int(Date().timeIntervalSince1970), radix: 36).suffix(5))")])
            try await core.call("client.save", client)
            check(try await core.call("client.load")["clientNumber"] == client["clientNumber"], "Swissquote login (Mock) stored natively")

            let passkey = try await core.call("setUpFaceId", client)
            check(passkey["protection"].string == "secure-enclave" && passkey["publicKey"].string?.count == 182,
                  "Face ID created the Secure Enclave key (P-256)")

            let started = Date()
            let created = try await core.call("createSafe", client, passkey)
            let profile = created["profile"]
            check(created["share"].string?.hasPrefix("h") == true && profile["mpcPublicKey"].string?.count == 66,
                  String(format: "2-of-3 MPC key generated in %.1f s", Date().timeIntervalSince(started)))
            check(profile["savingsAddress"].string?.hasPrefix("tb1q") == true, "Savings safe \(profile["savingsAddress"].string ?? "?")")

            let record = try await core.call("finishSetup", created["share"], "premium")
            check(!record["ownershipVerifiedAt"].isNull, "Swissquote verified the ownership proof (BIP-322, MPC signature, vault opened by Face ID)")

            let balances = try await core.call("loadBalances")
            check(balances["pocket"]["confirmed"].string != nil, "balances read from signet")
            let rulebook = try await core.call("loadRulebook", profile["walletId"])
            check(rulebook["contacts"].array.count >= 3, "rulebook: \(rulebook["contacts"].array.compactMap { $0["name"].string }.joined(separator: ", "))")

            try await core.call("forgetThisPhone")
            check(try await core.call("profile.load").isNull, "Lose this phone: profile, vault and Face ID key forgotten")
        } catch {
            check(false, error.localizedDescription)
        }
    }
}
