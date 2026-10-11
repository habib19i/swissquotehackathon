import SwiftUI
import UIKit

/// Colour tokens of the web app (apps/web/app/globals.css, measured from swissquote.com), light and dark.
/// Every pair used together is WCAG AA in both (replica/design/contrast.mjs).
nonisolated enum Theme {
    static let paper = color(light: 0xeff3fa, dark: 0x121417)
    static let surface = color(light: 0xffffff, dark: 0x1c1f24)
    static let surfaceAlt = color(light: 0xf3f4f6, dark: 0x262a30)
    static let ink = color(light: 0x000000, dark: 0xf3f4f6)
    static let inkSoft = color(light: 0x475467, dark: 0xa4adbb)
    static let line = color(light: 0xe5e7eb, dark: 0x2e333a)
    static let night = color(light: 0x323232, dark: 0x2b2f36)
    /// Swissquote orange: fills only, with black text on it.
    static let brand = color(light: 0xfa5b35, dark: 0xfa5b35)
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

    static let gutter: CGFloat = 24
    static let radiusPanel: CGFloat = 24
    static let radiusCard: CGFloat = 20
    static let radiusControl: CGFloat = 8

    /// Type scale at the web app's 18 px base: s 16, m 18, l 24, xl 32, amount 48.
    enum Text {
        static let s = Font.system(size: 16)
        static let m = Font.system(size: 18)
        static let l = Font.system(size: 24, weight: .bold)
        static let xl = Font.system(size: 32, weight: .bold)
        static let amount = Font.system(size: 48, weight: .bold)
    }

    private static func color(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? rgb(dark) : rgb(light) })
    }

    private static func rgb(_ hex: UInt32) -> UIColor {
        UIColor(red: CGFloat(hex >> 16 & 0xff) / 255, green: CGFloat(hex >> 8 & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: 1)
    }
}

/// The main action of a screen: Swissquote orange, black text, full width.
struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 18, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 56)
            .foregroundStyle(Theme.onBrand)
            .background(Theme.brand.opacity(configuration.isPressed ? 0.85 : 1), in: .rect(cornerRadius: Theme.radiusControl))
    }
}
