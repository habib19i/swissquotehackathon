import SwiftUI
import UIKit

/// Every screen (apps/web/components/screen.tsx): the brand bar, a "Back" link when the screen was opened
/// from another, the content, the main actions at the bottom within thumb reach, and on the main sections
/// the tab bar. The system navigation and tab bars are hidden: these are drawn as on the web.
struct Screen<Content: View, Actions: View>: View {
    private let tabs: Bool
    private let back: (() -> Void)?
    private let content: Content
    private let actions: Actions

    /// Read here so every screen redraws when the background colour changes in Settings.
    @AppStorage(Appearance.paperKey) private var paper = Appearance.Paper.swissquote.rawValue
    @Environment(\.isPresented) private var isPresented
    @Environment(\.dismiss) private var dismiss

    /// - Parameters:
    ///   - tabs: shows the tab bar (Home, Explore, Assistant, Send, Rules).
    ///   - back: what "Back" does; by default it closes the screen when it was opened from another.
    init(tabs: Bool = false, back: (() -> Void)? = nil, @ViewBuilder content: () -> Content, @ViewBuilder actions: () -> Actions) {
        self.tabs = tabs
        self.back = back
        self.content = content()
        self.actions = actions()
    }

    var body: some View {
        VStack(spacing: 0) {
            BrandBar()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if back != nil || isPresented {
                        BackLink { if let back { back() } else { dismiss() } }
                            .padding(.bottom, -12)
                    }
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Theme.gutter)
                .padding(.top, 20)
                .padding(.bottom, Theme.gutter)
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 0) {
                    if Actions.self != EmptyView.self {
                        VStack(spacing: 12) { actions }
                            .padding(.horizontal, Theme.gutter)
                            .padding(.top, 12)
                            .padding(.bottom, tabs ? 12 : 8)
                            .background(Theme.paper.opacity(0.94))
                    }
                    if tabs { TabBar() }
                }
            }
        }
        .background(Theme.paper.ignoresSafeArea())
        .foregroundStyle(Theme.ink)
        .tint(Theme.brandText)
        .font(Theme.Text.m)
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .ignoresSafeArea(.container, edges: tabs ? .bottom : [])
    }
}

extension Screen where Actions == EmptyView {
    init(tabs: Bool = false, back: (() -> Void)? = nil, @ViewBuilder content: () -> Content) {
        self.init(tabs: tabs, back: back, content: content, actions: { EmptyView() })
    }
}

/// The logo, "Swissquote / My Wallet", the light-dark switch and the prototype tag (which opens the Demo
/// panel). Stays at the top while the page scrolls, as the web's sticky bar.
private struct BrandBar: View {
    @Environment(\.openDemoPanel) private var openDemoPanel
    @Environment(\.colorScheme) private var scheme
    @AppStorage(Appearance.themeKey) private var theme = Appearance.Theme.system.rawValue

    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 10) {
                Image("swissquote-logo")
                    .resizable()
                    .scaleEffect(1.17)
                    .frame(width: 40, height: 40)
                    .clipShape(.circle)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Swissquote").font(.geist(18.9, .bold)).kerning(-0.47)
                    Text("My Wallet").font(.geist(14.4, .semibold)).foregroundStyle(Theme.brandText).kerning(0.14)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Swissquote Wallet")
            Spacer(minLength: 8)
            Button {
                theme = (scheme == .dark ? Appearance.Theme.light : .dark).rawValue
            } label: {
                Icon(scheme == .dark ? "sun" : "moon", size: 20)
                    .frame(width: 40, height: 40)
                    .background(Theme.surface, in: .circle)
                    .cardShadow()
            }
            .buttonStyle(.pressable)
            .accessibilityLabel("Switch between light and dark mode")
            Button("Hackathon prototype") { openDemoPanel() }
                .font(.geist(13.5, .semibold))
                .foregroundStyle(Theme.inkSoft)
                .lineLimit(1)
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(Theme.surface, in: .capsule)
                .accessibilityHint("Opens the demo panel")
        }
        .padding(.horizontal, Theme.gutter)
        .frame(minHeight: 64)
        .background(Theme.paper.opacity(0.85))
        .background(.ultraThinMaterial)
        .foregroundStyle(Theme.ink)
    }
}

/// "‹ Back", as the web's `.back` link.
private struct BackLink: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Icon("back", size: 20)
                Text("Back").font(Theme.Text.m)
            }
            .frame(minHeight: 48)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.ink)
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

/// With the navigation bar hidden, the edge swipe still goes back, as everywhere in iOS.
extension UINavigationController: @retroactive UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
    }

    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        viewControllers.count > 1
    }
}

// MARK: - Text styles

extension View {
    /// The screen's title (h1): 32 bold, tight.
    func titleStyle() -> some View {
        font(Theme.Text.xl).kerning(-0.64).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
    }

    /// A section title (h2): 24 bold.
    func sectionStyle() -> some View {
        font(Theme.Text.l).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
    }

    /// The sentence under the title (`.lead`).
    func leadStyle() -> some View {
        font(Theme.Text.m).foregroundStyle(Theme.inkSoft).fixedSize(horizontal: false, vertical: true)
    }

    /// `.small.muted`.
    func smallMuted() -> some View {
        font(Theme.Text.s).foregroundStyle(Theme.inkSoft).fixedSize(horizontal: false, vertical: true)
    }

    /// `.row-title`: bold.
    func rowTitle() -> some View {
        font(.geist(18, .bold)).foregroundStyle(Theme.ink)
    }
}

// MARK: - Buttons (`.button`, `.button.secondary`, `.button.quiet`)

/// The main action: an orange pill, black bold text.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.geist(18, .bold))
            .labelStyle(ButtonLabelStyle())
            .frame(maxWidth: .infinity, minHeight: 60)
            .padding(.horizontal, 24)
            .foregroundStyle(Theme.onBrand)
            .background(configuration.isPressed ? Theme.brandHover : Theme.brand, in: .capsule)
            .opacity(enabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// A second action: white pill, black outline and text.
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.geist(18, .bold))
            .labelStyle(ButtonLabelStyle())
            .frame(maxWidth: .infinity, minHeight: 60)
            .padding(.horizontal, 24)
            .foregroundStyle(Theme.ink)
            .background(configuration.isPressed ? Theme.surfaceAlt : Theme.surface, in: .capsule)
            .overlay(Capsule().strokeBorder(Theme.ink, lineWidth: 2))
            .opacity(enabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// A way out (Cancel, Choose someone else): underlined text.
struct QuietButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.geist(18, .medium))
            .underline(true, pattern: .solid)
            .frame(maxWidth: .infinity, minHeight: 48)
            .foregroundStyle(configuration.isPressed ? Theme.brandText : Theme.ink)
            .opacity(enabled ? 1 : 0.45)
    }
}

/// Cards and round buttons shrink a little when pressed, as on the web.
struct PressableButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// An icon and its text side by side, 10 apart, as in the web's buttons.
private struct ButtonLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 10) {
            configuration.icon
            configuration.title
        }
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

extension ButtonStyle where Self == PressableButtonStyle {
    static var pressable: PressableButtonStyle { PressableButtonStyle() }
}

/// The web's Face ID button label: its face icon and the text.
struct FaceIdLabel: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        HStack(spacing: 10) {
            Icon("face")
            Text(text)
        }
    }
}
