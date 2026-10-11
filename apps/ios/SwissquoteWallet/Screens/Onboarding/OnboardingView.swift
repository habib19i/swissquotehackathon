import SwiftUI

/// Onboarding (CLAUDE.md section 8): Open my safe, Face ID, key creation, ownership proof, recovery key,
/// plan, ready. Mirrors apps/web/app/onboarding/page.tsx.
struct OnboardingView: View {
    private enum Step { case intro, faceId, creating, verifying, recoveryKey, plan, ready }

    @Environment(Session.self) private var session
    @Environment(WalletCore.self) private var core
    @State private var step = Step.intro
    @State private var error: String?
    @State private var passkey: JSONValue?
    /// The new safe's profile, and the core's handle on the phone's key piece until the proof is done.
    @State private var created: (profile: JSONValue, share: String)?
    @State private var plan = "premium"
    /// Swissquote already knows a safe for this client: offer to bring it back rather than open a new one.
    @State private var existingSafe = false

    private var client: Client { session.client ?? .demo }

    var body: some View {
        content
            .animation(.easeOut(duration: 0.2), value: step)
            .task {
                existingSafe = (try? await core.call("cosigner.walletOfClient", client.clientNumber)) != nil
            }
    }

    @ViewBuilder private var content: some View {
        switch step {
        case .intro where existingSafe:
            Screen {
                Text("You already have a safe").titleStyle()
                Text("Swissquote knows a safe for your account, but this phone does not hold it. If you lost your phone or changed it, bring your safe here with your recovery key.").leadStyle()
            } actions: {
                NavigationLink("Bring my safe to this phone") { RecoverView() }.buttonStyle(.primary)
                Button("Open a new safe instead") { existingSafe = false }.buttonStyle(.quiet)
            }

        case .intro:
            Screen {
                Text("Open your own safe").titleStyle()
                Text("A safe for your bitcoin and USDC that only you can open, with your face. Swissquote watches over it, but can never open it alone.").leadStyle()
                ProtectedBySwissquote()
            } actions: {
                Button("Open my safe") { step = .faceId }.buttonStyle(.primary)
            }

        case .faceId:
            Screen {
                Text("Lock it with your face").titleStyle()
                Text("Face ID will be the only key you need. No password, nothing to write down.").leadStyle()
                if let error { Notice(.error, error) }
            } actions: {
                Button { Task { await enableFaceId() } } label: { FaceIdLabel("Use Face ID") }
                    .buttonStyle(.primary)
            }

        case .creating, .verifying:
            let verifying = step == .verifying
            Screen {
                Text(verifying ? "Swissquote is checking your safe" : "Creating your safe").titleStyle()
                Text(verifying
                     ? "Your safe signs a short statement that it belongs to you. Swissquote checks it, so you never need screenshots or forms to prove it."
                     : "Your key is made in three pieces, for three different holders. Nobody, not even Swissquote, ever holds the whole key.")
                    .leadStyle()
                KeyHolders(ready: [verifying, verifying, verifying])
                if let error {
                    Notice(.error, error)
                } else {
                    Text(progressText(verifying: verifying)).leadStyle().accessibilityAddTraits(.updatesFrequently)
                }
            } actions: {
                if error != nil {
                    Button("Try again") { Task { verifying ? await verify() : await create() } }.buttonStyle(.primary)
                }
            }

        case .recoveryKey:
            RecoveryKeySetup { step = .plan }

        case .plan:
            Screen {
                Text("Choose your plan").titleStyle()
                PlanChoice(plan: $plan)
                Text("You can change your plan at any time.").smallMuted()
                if let error { Notice(.error, error) }
            } actions: {
                Button("Continue with \(plan == "premium" ? "Premium" : "Standard")") { Task { await choosePlan() } }
                    .buttonStyle(.primary)
            }

        case .ready:
            Screen {
                Text("Your safe is ready").titleStyle()
                KeyHolders(ready: [true, true, true])
                RowsGroup {
                    ForEach([
                        "You hold one piece, on this phone, unlocked only with Face ID.",
                        "Swissquote holds one piece, to check your larger payments.",
                        "An independent safe-keeper holds one piece, to help you if you lose your phone.",
                        "The same key holds your bitcoin and your USDC.",
                    ], id: \.self) { line in
                        Text(line).font(Theme.Text.m).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 18)
                    }
                }
                ProtectedBySwissquote(text: "Swissquote has verified that this safe is yours")
                Text("Any two pieces together can move your money. Swissquote alone never can.").smallMuted()
                if !FaceIdKey.enforcedBySecureEnclave {
                    Text("Prototype note: the iOS Simulator cannot tie your piece to Face ID inside the Secure Enclave, so the app asks Face ID before each use. On an iPhone the Secure Enclave enforces it.")
                        .smallMuted()
                }
            } actions: {
                Button("Go to my safe") { Task { await session.reload() } }.buttonStyle(.primary)
            }
        }
    }

    private func progressText(verifying: Bool) -> String {
        if verifying { return "Confirming that this safe is yours…" }
        guard let progress = core.progress, progress.event == "keygen-progress", progress.round > 0 else {
            return "Connecting to Swissquote and the safe-keeper…"
        }
        return "Making the pieces: step \(progress.round) of \(progress.total)"
    }

    // MARK: - Steps

    private func enableFaceId() async {
        error = nil
        do {
            passkey = try await core.call("setUpFaceId", client)
            await create()
        } catch {
            self.error = "Face ID was not set up: \(error.localizedDescription)"
        }
    }

    private func create() async {
        guard let passkey else { return }
        error = nil
        step = .creating
        do {
            let result = try await core.call("createSafe", client, passkey)
            guard let share = result["share"].string else { throw CoreError(name: "BadAnswer", message: "No key piece came back.") }
            created = (result["profile"], share)
            await verify()
        } catch {
            self.error = "Your safe could not be created: \(error.localizedDescription)"
        }
    }

    /// Registration and ownership proof. The core keeps the key piece until this succeeds or is retried.
    private func verify() async {
        guard let created else { return }
        error = nil
        step = .verifying
        do {
            try await core.call("finishSetup", created.share)
            step = .recoveryKey
        } catch {
            self.error = "Swissquote could not verify your safe yet: \(error.localizedDescription)"
        }
    }

    private func choosePlan() async {
        guard let walletId = created?.profile["walletId"].string else { return }
        error = nil
        do {
            try await core.call("cosigner.setPlan", walletId, plan)
            step = .ready
        } catch {
            self.error = "Your plan could not be saved: \(error.localizedDescription)"
        }
    }
}

/// Premium or Standard (CLAUDE.md section 7). Prices are a mock for the prototype.
struct PlanChoice: View {
    @Binding var plan: String

    private static let plans = [
        (id: "premium", name: "Premium", price: "CHF 9 per month",
         description: "Swissquote pays every network fee for you, and keeps your recovery service running."),
        (id: "standard", name: "Standard", price: "Free",
         description: "Recovery included. You pay the small network fee of each payment from your own bitcoin."),
    ]

    var body: some View {
        VStack(spacing: 12) {
            ForEach(Self.plans, id: \.id) { option in
                ChoiceCard(selected: plan == option.id, action: { plan = option.id }) {
                    HStack {
                        Text(option.name).rowTitle()
                        Spacer()
                        Text(option.price).monospacedDigit()
                        if option.id == "premium" { MockTag() }
                    }
                    Text(option.description).smallMuted()
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Plan")
    }
}
