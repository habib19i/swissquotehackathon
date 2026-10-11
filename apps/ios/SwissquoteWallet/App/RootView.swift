import SwiftUI

/// Log in, open a safe, or the app itself, as the web app's `RequireWallet` decides.
struct RootView: View {
    @AppStorage(Appearance.themeKey) private var theme = Appearance.Theme.system.rawValue
    @Environment(Session.self) private var session
    @Environment(WalletCore.self) private var core
    @State private var navigation = Navigation()

    var body: some View {
        Group {
            if case .failed(let reason) = core.state {
                CoreUnavailable(reason: reason)
            } else if session.loading {
                ProgressView("Opening your safe…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Theme.paper)
            } else if let profile = session.profile {
                MainTabs(profile: profile)
            } else if session.client != nil {
                NavigationStack { OnboardingView().withRoutes() }
            } else {
                NavigationStack { LoginView().withRoutes() }
            }
        }
        .environment(navigation)
        .preferredColorScheme(Appearance.Theme(rawValue: theme)?.colorScheme)
        .environment(\.openDemoPanel) {
            if session.profile != nil {
                navigation.tab = .home
                navigation.homePath.append(Route.demo)
            } else {
                showDemoPanel = true
            }
        }
        .sheet(isPresented: $showDemoPanel) {
            NavigationStack { DemoPanelView().withRoutes() }.environment(navigation)
        }
        .onChange(of: session.profile?.walletId) { navigation.reset() }
    }

    @State private var showDemoPanel = false
}

/// The five sections, at thumb height; the assistant sits in the middle.
private struct MainTabs: View {
    let profile: WalletProfile
    @Environment(Navigation.self) private var navigation

    var body: some View {
        @Bindable var navigation = navigation
        TabView(selection: $navigation.tab) {
            Tab("Home", systemImage: "house", value: .home) {
                NavigationStack(path: $navigation.homePath) { HomeView(profile: profile).withRoutes(profile: profile) }
            }
            Tab("Explore", systemImage: "safari", value: .explore) {
                NavigationStack { NotYetInApp(title: "Explore", step: 5).withRoutes(profile: profile) }
            }
            Tab("Assistant", systemImage: "bubble.left.and.text.bubble.right", value: .assistant) {
                NavigationStack { AssistantView(profile: profile).withRoutes(profile: profile) }
            }
            Tab("Send", systemImage: "arrow.up.right", value: .send) {
                NavigationStack { SendView(profile: profile).withRoutes(profile: profile) }
            }
            Tab("Rules", systemImage: "list.bullet.rectangle", value: .rules) {
                NavigationStack { RulesView(profile: profile).withRoutes(profile: profile) }
            }
        }
        .tint(Theme.brandText)
    }
}

private extension View {
    /// The screens Home and the brand bar can push.
    func withRoutes(profile: WalletProfile? = nil) -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case .demo: DemoPanelView()
            case .receive: if let profile { ReceiveView(profile: profile) }
            case .recoveryKey: RecoveryKeyAgain()
            case .activity: ActivityView()
            case .alerts: if let profile { AlertsView(profile: profile) }
            case .settings: if let profile { SettingsView(profile: profile) }
            case .attacker: if let profile { AttackerView(profile: profile) }
            }
        }
    }
}

/// Home's "Add your recovery key", for a safe opened without one.
private struct RecoveryKeyAgain: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View { RecoveryKeySetup { dismiss() } }
}

/// A screen of the web app not yet ported (docs/ios-plan.md, build order). Says so plainly.
struct NotYetInApp: View {
    let title: String
    let step: Int

    var body: some View {
        Screen {
            Text(title).titleStyle()
            Notice(.warn, "This screen comes to the iOS app in step \(step) of the build plan. Meanwhile it works in the web app.")
            Link("Open the web app", destination: AppConfig.webURL).font(.system(size: 18, weight: .semibold))
        }
    }
}

/// The wallet core could not start: nothing works without it, so say why.
private struct CoreUnavailable: View {
    let reason: String
    @Environment(WalletCore.self) private var core

    var body: some View {
        Screen {
            Text("The app could not start").titleStyle()
            Notice(.error, reason)
        } actions: {
            Button("Try again") { core.start() }.buttonStyle(.primary)
        }
    }
}
