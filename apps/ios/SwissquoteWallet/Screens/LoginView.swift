import SwiftUI

/// MOCK Swissquote login: the client already has an account and has passed KYC.
struct LoginView: View {
    @Environment(Session.self) private var session
    @State private var clientNumber = Client.demo.clientNumber
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        Screen {
            Text("Log in to your Swissquote account").titleStyle()
            Text("Your identity is already verified with Swissquote, so there is nothing else to fill in.").leadStyle()
            VStack(alignment: .leading, spacing: 8) {
                Text("Client number").font(.system(size: 18, weight: .semibold))
                ClientNumberField(text: $clientNumber)
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                MockTag()
                Text("The Swissquote login and identity check are simulated in this prototype.").smallMuted()
            }
            if let error { Notice(.error, error) }
        } actions: {
            Button(busy ? "Logging in…" : "Log in") { Task { await logIn() } }
                .buttonStyle(.primary)
                .disabled(busy)
            NavigationLink("I lost my phone") { RecoverView() }
                .buttonStyle(.quiet)
        }
    }

    private func logIn() async {
        busy = true
        defer { busy = false }
        let number = clientNumber.trimmingCharacters(in: .whitespaces)
        do {
            try await session.logIn(Client(name: Client.demo.name, clientNumber: number.isEmpty ? Client.demo.clientNumber : number))
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// The client number, in large tabular digits.
struct ClientNumberField: View {
    @Binding var text: String

    var body: some View {
        TextField("CH-0000-0000", text: $text)
            .font(.system(size: 22, weight: .medium).monospacedDigit())
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
            .textContentType(.username)
            .padding(16)
            .background(Theme.surface, in: .rect(cornerRadius: Theme.radiusControl))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusControl).stroke(Theme.inkSoft))
            .accessibilityLabel("Client number")
    }
}
