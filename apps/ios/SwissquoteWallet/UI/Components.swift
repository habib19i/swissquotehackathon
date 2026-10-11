import SwiftUI

/// A message in a tinted box: information, success, a warning or an error.
struct Notice<Content: View>: View {
    enum Kind { case info, ok, warn, error }

    let kind: Kind
    @ViewBuilder let content: Content

    init(_ kind: Kind = .info, @ViewBuilder content: () -> Content) {
        self.kind = kind
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) { content }
            .font(Theme.Text.m)
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(background, in: .rect(cornerRadius: Theme.radiusCard))
            .accessibilityElement(children: .combine)
    }

    private var foreground: Color {
        switch kind {
        case .info: Theme.ink
        case .ok: Theme.protect
        case .warn: Theme.warn
        case .error: Theme.danger
        }
    }

    private var background: Color {
        switch kind {
        case .info: Theme.surface
        case .ok: Theme.protectBg
        case .warn: Theme.warnBg
        case .error: Theme.dangerBg
        }
    }
}

extension Notice where Content == Text {
    init(_ kind: Kind, _ text: String) {
        self.init(kind) { Text(text) }
    }

    init(_ text: String) {
        self.init(.info) { Text(text) }
    }
}

/// Everything simulated in the prototype says so.
struct MockTag: View {
    var text = "Mock"

    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(Theme.warn)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(Theme.warnBg, in: .capsule)
            .overlay(Capsule().stroke(Theme.warn.opacity(0.4)))
    }
}

/// "Demo mode: 48 hours in real life".
struct DemoModeTag: View {
    let production: String
    var body: some View { MockTag(text: "Demo mode: \(production) in real life") }
}

struct ProtectedBySwissquote: View {
    var body: some View {
        Label("Protected by Swissquote", systemImage: "checkmark.shield.fill")
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(Theme.protect)
    }
}

/// The three holders of the 2-of-3 key; `ready[i]` marks a holder whose piece is in place.
struct KeyHolders: View {
    static let names = ["You, on this phone", "Swissquote", "Independent safe-keeper"]
    let ready: [Bool]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(Self.names.enumerated()), id: \.offset) { index, name in
                HStack(spacing: 12) {
                    ZStack {
                        Circle().fill(ready[index] ? Theme.protect : Theme.surfaceAlt).frame(width: 28, height: 28)
                        if ready[index] {
                            Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                        }
                    }
                    .animation(.easeOut(duration: 0.3), value: ready[index])
                    Text(name).font(Theme.Text.m)
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(ready[index] ? "ready" : "waiting")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Who holds a piece of your key")
    }
}

/// "0:23 left", updated every second; "now" once the time has come. `prefix` keeps a sentence and its
/// countdown in one text, so they wrap together.
struct Countdown: View {
    let until: Date
    var prefix = ""
    var onDone: () -> Void = {}

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let left = max(0, Int(until.timeIntervalSince(context.date).rounded(.up)))
            (Text(prefix) + Text(left == 0 ? "now" : "\(left / 60):\(String(format: "%02d", left % 60)) left").bold())
                .monospacedDigit()
                .onChange(of: left == 0) { _, done in if done { onDone() } }
        }
    }
}

/// The round letter used for people and the client.
struct Avatar: View {
    let text: String
    var size: CGFloat = 44

    var body: some View {
        Text(text)
            .font(.system(size: size * 0.4, weight: .bold))
            .frame(width: size, height: size)
            .foregroundStyle(Theme.ink)
            .background(Theme.brandTint, in: .circle)
            .accessibilityHidden(true)
    }
}

/// Token marks: bitcoin, USDC and ETH. Decorative: names are always shown next to them.
struct TokenMark: View {
    enum Token { case btc, usdc, eth }

    let token: Token
    var size: CGFloat = 46
    /// The Savings safe's small vault badge on the bitcoin mark.
    var vaultBadge = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            ZStack {
                Circle().fill(fill)
                switch token {
                case .btc: Image(systemName: "bitcoinsign").font(.system(size: size * 0.5, weight: .bold)).rotationEffect(.degrees(14))
                case .usdc: Image(systemName: "dollarsign").font(.system(size: size * 0.5, weight: .bold))
                case .eth: Image(systemName: "diamond.fill").font(.system(size: size * 0.45)).scaleEffect(x: 0.7, y: 1.1)
                }
            }
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            if vaultBadge {
                Image(systemName: "lock.fill")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Theme.ink)
                    .frame(width: 20, height: 20)
                    .background(Theme.surface, in: .circle)
                    .overlay(Circle().stroke(Theme.line))
                    .offset(x: 4, y: 4)
            }
        }
        .accessibilityHidden(true)
    }

    private var fill: Color {
        switch token {
        case .btc: Color(red: 0xf7 / 255, green: 0x93 / 255, blue: 0x1a / 255)
        case .usdc: Theme.usdc
        case .eth: Color(red: 0x62 / 255, green: 0x7e / 255, blue: 0xea / 255)
        }
    }
}

/// A row in a list: a white card with optional leading mark and trailing amount.
struct RowCard<Leading: View, Trailing: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var leading: Leading
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 14) {
            leading
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 18, weight: .semibold)).foregroundStyle(Theme.ink)
                if let subtitle { Text(subtitle).smallMuted() }
            }
            Spacer(minLength: 8)
            trailing
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
        .background(Theme.surface, in: .rect(cornerRadius: Theme.radiusCard))
        .contentShape(.rect)
    }
}

/// A link to a transaction on an explorer.
struct ExplorerLink: View {
    let label: String
    let url: URL

    var body: some View {
        Link(destination: url) {
            Label(label, systemImage: "arrow.up.right.square").font(Theme.Text.s)
        }
        .foregroundStyle(Theme.brandText)
    }
}

/// "From … / To …" style details: label on the left, value on the right.
struct DetailRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(Theme.inkSoft)
            Spacer(minLength: 16)
            Text(value).multilineTextAlignment(.trailing).monospacedDigit()
        }
        .font(Theme.Text.m)
        .accessibilityElement(children: .combine)
    }
}

/// Large, card-like choice (plans, recovery key kinds), selected with a ring.
struct ChoiceCard<Content: View>: View {
    let selected: Bool
    let action: () -> Void
    @ViewBuilder let content: Content

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) { content }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .background(Theme.surface, in: .rect(cornerRadius: Theme.radiusCard))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusCard).stroke(selected ? Theme.brand : Theme.line, lineWidth: selected ? 3 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}
