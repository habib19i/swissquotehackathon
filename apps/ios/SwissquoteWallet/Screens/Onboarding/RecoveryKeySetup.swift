import SwiftUI

/// Registers the RECOVERY key with the independent recovery provider (CLAUDE.md section 5). It is only
/// used if this phone is lost, never for payments. The ceremony runs on the web page
/// `/native/recovery-key` (see RecoveryKeySession).
struct RecoveryKeySetup: View {
    @Environment(WalletCore.self) private var core
    var onDone: () -> Void

    @State private var kind = "security-key"
    @State private var busy = false
    @State private var error: String?

    private static let kinds = [
        (id: "security-key", name: "Security key from Swissquote",
         description: "A small key Swissquote sends you by post. Keep it at home, away from your phone. Recommended."),
        (id: "synced", name: "Passkey in your Apple or Google account",
         description: "More convenient, but whoever controls that account could use it too."),
    ]

    var body: some View {
        Screen {
            Text("Add your recovery key").titleStyle()
            Text("If you lose this phone, your recovery key and a face check bring your safe back on a new phone. You will not need it for payments.").leadStyle()
            VStack(spacing: 12) {
                ForEach(Self.kinds, id: \.id) { option in
                    ChoiceCard(selected: kind == option.id, action: { kind = option.id }) {
                        Text(option.name).font(.system(size: 18, weight: .bold))
                        Text(option.description).smallMuted()
                    }
                }
            }
            if kind == "synced" {
                Notice(.warn, "A synced passkey is only as safe as your Apple or Google account. If someone takes over that account, they get one of the two things needed to move your safe.")
            }
            if let error { Notice(.error, error) }
        } actions: {
            Button(busy ? "Waiting for your key…" : kind == "security-key" ? "Use my security key" : "Create the passkey") {
                Task { await register() }
            }
            .buttonStyle(.primary)
            .disabled(busy)
        }
    }

    private func register() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await core.call("addRecoveryKey", kind)
            onDone()
        } catch {
            self.error = error.localizedDescription == "cancelled"
                ? "Your recovery key was not added: you cancelled."
                : "Your recovery key was not added: \(error.localizedDescription)"
        }
    }
}
