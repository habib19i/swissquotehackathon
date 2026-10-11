import SwiftUI

/// Every screen (apps/web/components/screen.tsx): brand bar, content, the main actions at the bottom.
/// The tab bar and the back button come from the TabView and NavigationStack around it.
struct Screen<Content: View, Actions: View>: View {
    private let content: Content
    private let actions: Actions
    /// Read here so every screen redraws when the background colour changes in Settings.
    @AppStorage(Appearance.paperKey) private var paper = Appearance.Paper.swissquote.rawValue

    init(@ViewBuilder content: () -> Content, @ViewBuilder actions: () -> Actions) {
        self.content = content()
        self.actions = actions()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                BrandBar()
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Theme.gutter)
            .padding(.bottom, Theme.gutter)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            if Actions.self != EmptyView.self {
                VStack(spacing: 12) { actions }
                    .padding(.horizontal, Theme.gutter)
                    .padding(.vertical, 12)
                    .background(Theme.paper.opacity(0.95))
            }
        }
        .background(Theme.paper)
        .foregroundStyle(Theme.ink)
        .tint(Theme.brandText)
        .toolbarBackground(Theme.paper, for: .navigationBar)
    }
}

extension Screen where Actions == EmptyView {
    init(@ViewBuilder content: () -> Content) {
        self.init(content: content, actions: { EmptyView() })
    }
}

/// "Swissquote · My Wallet" and the prototype tag, which opens the Demo panel.
private struct BrandBar: View {
    @Environment(\.openDemoPanel) private var openDemoPanel

    var body: some View {
        HStack(spacing: 12) {
            Image("swissquote-logo")
                .resizable()
                .frame(width: 40, height: 40)
                .clipShape(.rect(cornerRadius: 10))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text("Swissquote").font(.system(size: 18, weight: .bold))
                Text("My Wallet").font(Theme.Text.s).foregroundStyle(Theme.inkSoft)
            }
            Spacer()
            Button("Hackathon prototype") { openDemoPanel() }
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.inkSoft)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Theme.surfaceAlt, in: .capsule)
                .accessibilityHint("Opens the demo panel")
        }
        .accessibilityElement(children: .contain)
        .padding(.top, 4)
    }
}

/// Opens the Demo panel from any screen (set by the app's root).
struct OpenDemoPanelKey: EnvironmentKey {
    static let defaultValue: @MainActor () -> Void = {}
}

extension EnvironmentValues {
    var openDemoPanel: @MainActor () -> Void {
        get { self[OpenDemoPanelKey.self] }
        set { self[OpenDemoPanelKey.self] = newValue }
    }
}

// MARK: - Text styles

extension View {
    /// The screen's title (h1).
    func titleStyle() -> some View {
        font(Theme.Text.xl).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
    }

    /// The sentence under the title.
    func leadStyle() -> some View {
        font(Theme.Text.m).foregroundStyle(Theme.inkSoft).fixedSize(horizontal: false, vertical: true)
    }

    func smallMuted() -> some View {
        font(Theme.Text.s).foregroundStyle(Theme.inkSoft).fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Buttons

/// A second action: white card, ink text.
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 18, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 56)
            .foregroundStyle(Theme.ink.opacity(enabled ? 1 : 0.4))
            .background(Theme.surface.opacity(configuration.isPressed ? 0.8 : 1), in: .rect(cornerRadius: Theme.radiusControl))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusControl).stroke(Theme.line))
    }
}

/// A way out (Cancel, Choose someone else): text only.
struct QuietButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 18, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 48)
            .foregroundStyle(Theme.brandText.opacity(configuration.isPressed ? 0.6 : 1))
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var primary: PrimaryButtonStyle { PrimaryButtonStyle() }
}

extension ButtonStyle where Self == SecondaryButtonStyle {
    static var secondary: SecondaryButtonStyle { SecondaryButtonStyle() }
}

extension ButtonStyle where Self == QuietButtonStyle {
    static var quiet: QuietButtonStyle { QuietButtonStyle() }
}
