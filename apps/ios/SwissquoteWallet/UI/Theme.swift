import SwiftUI
import UIKit

/// The web app's design tokens (apps/web/app/globals.css, measured from swissquote.com), light and dark.
/// Every pair used together is WCAG AA in both (replica/design/contrast.mjs). Sizes are the CSS values at
/// the web's 18 px base; text also follows the phone's text size (Dynamic Type).
nonisolated enum Theme {
    /// The page background, as chosen in Settings (Swissquote's soft blue-grey by default).
    static var paper: Color {
        let choice = UserDefaults.standard.string(forKey: Appearance.paperKey).flatMap(Appearance.Paper.init(rawValue:)) ?? .swissquote
        return choice.color
    }

    static let surface = color(light: 0xffffff, dark: 0x1c1f24)
    static let surfaceAlt = color(light: 0xf3f4f6, dark: 0x262a30)
    static let ink = color(light: 0x000000, dark: 0xf3f4f6)
    static let inkSoft = color(light: 0x475467, dark: 0xa4adbb)
    static let line = color(light: 0xe5e7eb, dark: 0x2e333a)
    static let night = color(light: 0x323232, dark: 0x2b2f36)
    /// Swissquote orange: fills only, with black text on it.
    static let brand = color(light: 0xfa5b35, dark: 0xfa5b35)
    static let brandHover = color(light: 0xe45330, dark: 0xe45330)
    static let onBrand = Color.black
    static let brandText = color(light: 0xb24126, dark: 0xff8c6e)
    static let brandTint = color(light: 0xffebe6, dark: 0x3a1f17)
    static let usdc = color(light: 0x2775ca, dark: 0x2775ca)
    static let protect = color(light: 0x00724d, dark: 0x5cc79a)
    static let protectBg = color(light: 0xe6f4ef, dark: 0x10261d)
    static let warn = color(light: 0x7a5419, dark: 0xf0c46a)
    static let warnBg = color(light: 0xfffaf0, dark: 0x2a2210)
    static let danger = color(light: 0xb30c00, dark: 0xff7b6e)
    static let dangerBg = color(light: 0xffebeb, dark: 0x2c1513)
    static let focus = color(light: 0x2563eb, dark: 0x6ea0ff)

    static let gutter: CGFloat = 24
    static let radiusPanel: CGFloat = 24
    static let radiusCard: CGFloat = 20
    static let radiusControl: CGFloat = 8

    /// Type scale: s 15.75, m 18, l 24, xl 32, amount 48 (0.875rem … 2.667rem at 18 px).
    enum Text {
        static let s = Font.geist(15.75)
        static let m = Font.geist(18)
        static let l = Font.geist(24, .bold)
        static let xl = Font.geist(32, .bold)
        static let amount = Font.geist(48, .bold)
    }

    static func color(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? rgb(dark) : rgb(light) })
    }

    private static func rgb(_ hex: UInt32) -> UIColor {
        UIColor(red: CGFloat(hex >> 16 & 0xff) / 255, green: CGFloat(hex >> 8 & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: 1)
    }
}

extension Font {
    /// Geist, the web app's typeface, scaled with the phone's text size.
    nonisolated static func geist(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        let name = switch weight {
        case .medium: "Geist-Medium"
        case .semibold: "Geist-SemiBold"
        case .bold, .heavy, .black: "Geist-Bold"
        default: "Geist-Regular"
        }
        return .custom(name, size: size, relativeTo: size >= 28 ? .largeTitle : size >= 22 ? .title2 : size >= 17 ? .body : .subheadline)
    }
}

/// The web's two shadows: `--shadow-s` on cards and `--shadow-m` on raised panels, darker in dark mode.
struct CardShadow: ViewModifier {
    enum Size { case s, m }
    let size: Size
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let dark = scheme == .dark
        let base = dark ? Color.black : Color(red: 0x32 / 255, green: 0x32 / 255, blue: 0x32 / 255)
        switch size {
        case .s:
            content
                .shadow(color: base.opacity(dark ? 0.40 : 0.10), radius: 4, x: 0, y: 3)
                .shadow(color: base.opacity(dark ? 0.30 : 0.06), radius: 2, x: 0, y: 1)
        case .m:
            content
                .shadow(color: base.opacity(dark ? 0.50 : 0.08), radius: 8, x: 0, y: 8)
                .shadow(color: base.opacity(dark ? 0.30 : 0.03), radius: 3, x: 0, y: 3)
        }
    }
}

extension View {
    func cardShadow(_ size: CardShadow.Size = .s) -> some View { modifier(CardShadow(size: size)) }

    /// A white card: `.card`, `.asset`, `.quick-action` on the web.
    func card(padding: CGFloat = 20, radius: CGFloat = Theme.radiusCard) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: .rect(cornerRadius: radius))
            .cardShadow()
    }
}

/// One of the web app's line icons (apps/web/components/icons.tsx: 24 px grid, 2 px stroke), as a vector
/// template image tinted like text.
struct Icon: View {
    let name: String
    var size: CGFloat = 24

    init(_ name: String, size: CGFloat = 24) {
        self.name = name
        self.size = size
    }

    var body: some View {
        Image("icon-\(name)")
            .renderingMode(.template)
            .resizable()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
