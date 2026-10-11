import SwiftUI

/// A message box (`.notice`): white with a shadow for information; tinted with a coloured border for
/// success, a warning or an error. Text stays ink, except on errors.
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
            .foregroundStyle(kind == .error ? Theme.danger : Theme.ink)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(background, in: .rect(cornerRadius: Theme.radiusCard))
            .overlay {
                if let border { RoundedRectangle(cornerRadius: Theme.radiusCard).strokeBorder(border, lineWidth: 1) }
            }
            .cardShadow()
            .accessibilityElement(children: .combine)
    }

    private var background: Color {
        switch kind {
        case .info: Theme.surface
        case .ok: Theme.protectBg
        case .warn: Theme.warnBg
        case .error: Theme.dangerBg
        }
    }

    private var border: Color? {
        switch kind {
        case .info: nil
        case .ok: Theme.protect
        case .warn: Theme.warn
        case .error: Theme.danger
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

/// Everything simulated in the prototype says so (`.mock`).
struct MockTag: View {
    var text = "Mock"

    var body: some View {
        Text(text)
            .font(.geist(15.75, .semibold))
            .foregroundStyle(Theme.warn)
            .padding(.horizontal, 10)
            .padding(.vertical, 1)
            .background(Theme.warnBg, in: .capsule)
    }
}

/// "Demo mode: 48 hours in real life".
struct DemoModeTag: View {
    let production: String
    var body: some View { MockTag(text: "Demo mode: \(production) in real life") }
}

/// The shield and "Protected by Swissquote" (`.protected`).
struct ProtectedBySwissquote: View {
    var text = "Protected by Swissquote"

    var body: some View {
        HStack(spacing: 8) {
            Icon("shield", size: 22)
            Text(text).font(.geist(18, .semibold))
        }
        .foregroundStyle(Theme.protect)
    }
}

/// The three holders of the 2-of-3 key side by side (`.keyholders.light`); `ready[i]` marks a holder whose
/// piece is in place.
struct KeyHolders: View {
    static let names = ["You, on this phone", "Swissquote", "Independent safe-keeper"]
    let ready: [Bool]

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Theme.line).frame(height: 1)
            HStack(alignment: .top, spacing: 8) {
                ForEach(Array(Self.names.enumerated()), id: \.offset) { index, name in
                    VStack(alignment: .leading, spacing: 6) {
                        ZStack {
                            Circle().strokeBorder(ready[index] ? Theme.protect : Theme.line, lineWidth: 2)
                                .background(Circle().fill(ready[index] ? Theme.protect : .clear))
                            if ready[index] { Icon("check", size: 16).foregroundStyle(Theme.surface) }
                        }
                        .frame(width: 28, height: 28)
                        .animation(.easeOut(duration: 0.3), value: ready[index])
                        Text(name).font(.geist(15.75)).lineSpacing(-2).foregroundStyle(Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .combine)
                    .accessibilityValue(ready[index] ? "ready" : "waiting")
                }
            }
            .padding(.top, 16)
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

/// A person or the client: their initial on Swissquote's tint, in a rounded square (`.avatar`).
struct Avatar: View {
    let text: String
    var size: CGFloat = 48

    var body: some View {
        Text(text)
            .font(.geist(18, .bold))
            .frame(width: size, height: size)
            .foregroundStyle(Theme.brandText)
            .background(Theme.brandTint, in: .rect(cornerRadius: size * 14 / 48))
            .accessibilityHidden(true)
    }
}

/// The web's token marks (bitcoin, USDC, ETH), with the Savings safe's vault badge or an app's letter
/// (`.coin`, `.coin-badge`). Decorative: names are always shown next to them.
struct TokenMark: View {
    enum Token: String { case btc, usdc, eth }
    enum Badge { case vault, app(String) }

    let token: Token
    var size: CGFloat = 46
    var badge: Badge?

    init(token: Token, size: CGFloat = 46, vaultBadge: Bool = false, badge: Badge? = nil) {
        self.token = token
        self.size = size
        self.badge = badge ?? (vaultBadge ? .vault : nil)
    }

    var body: some View {
        Image("token-\(token.rawValue)")
            .resizable()
            .frame(width: size, height: size)
            .overlay(alignment: .bottomTrailing) {
                if let badge {
                    Group {
                        switch badge {
                        case .vault:
                            Icon("vault", size: 12).foregroundStyle(.white)
                                .frame(width: 22, height: 22).background(Theme.night, in: .circle)
                        case .app(let letter):
                            Text(letter).font(.geist(12.6, .bold)).foregroundStyle(.black)
                                .frame(width: 22, height: 22)
                                .background(Color(red: 0x93 / 255, green: 0x91 / 255, blue: 0xf7 / 255), in: .circle)
                        }
                    }
                    .overlay(Circle().strokeBorder(Theme.surface, lineWidth: 2).padding(-2))
                    .offset(x: 3, y: 3)
                }
            }
            .accessibilityHidden(true)
    }
}

/// A card in a list (`.asset`): leading mark, title and detail, trailing amount.
struct RowCard<Leading: View, Trailing: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var leading: Leading
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 14) {
            leading
            VStack(alignment: .leading, spacing: 2) {
                Text(title).rowTitle()
                if let subtitle { Text(subtitle).smallMuted() }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: .rect(cornerRadius: Theme.radiusCard))
        .cardShadow()
        .contentShape(.rect)
    }
}

/// Rows in one white card, separated by thin lines (`.rows`): contacts, choices, settings.
struct RowsGroup<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            Group(subviews: content) { rows in
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    row
                    if index < rows.count - 1 { Rectangle().fill(Theme.line).frame(height: 1) }
                }
            }
        }
        .padding(.horizontal, 16)
        .background(Theme.surface, in: .rect(cornerRadius: Theme.radiusCard))
        .cardShadow()
    }
}

/// One row of a `RowsGroup` (`.row`): leading mark, title and detail, trailing content.
struct GroupRow<Leading: View, Trailing: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var leading: Leading
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 16) {
            leading
            VStack(alignment: .leading, spacing: 2) {
                Text(title).rowTitle()
                if let subtitle { Text(subtitle).smallMuted() }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .padding(.vertical, 18)
        .contentShape(.rect)
    }
}

extension GroupRow where Leading == EmptyView {
    init(title: String, subtitle: String? = nil, @ViewBuilder trailing: () -> Trailing) {
        self.init(title: title, subtitle: subtitle, leading: { EmptyView() }, trailing: trailing)
    }
}

/// A link to a transaction on an explorer (`.small` link in Swissquote's orange text colour).
struct ExplorerLink: View {
    let label: String
    let url: URL

    var body: some View {
        Link(destination: url) {
            Text(label).font(.geist(15.75, .medium)).underline()
        }
        .foregroundStyle(Theme.brandText)
    }
}

/// A label and its value on one line (`.slip-details`): muted label, bold value on the right.
struct DetailRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(label).foregroundStyle(Theme.inkSoft)
            Spacer(minLength: 0)
            Text(value).font(.geist(18, .semibold)).multilineTextAlignment(.trailing).monospacedDigit()
        }
        .font(Theme.Text.m)
        .accessibilityElement(children: .combine)
    }
}

/// A large choice (`.plan`): a white card, outlined in orange when selected.
struct ChoiceCard<Content: View>: View {
    let selected: Bool
    let action: () -> Void
    @ViewBuilder let content: Content

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) { content }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(18)
                .background(Theme.surface, in: .rect(cornerRadius: Theme.radiusCard))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusCard)
                    .strokeBorder(selected ? Theme.brand : Theme.line, lineWidth: selected ? 2 : 1))
                .cardShadow()
                .foregroundStyle(Theme.ink)
        }
        .buttonStyle(.pressable)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

/// Two or three options in a pill (`.segmented`): the chosen one is white and raised.
struct Segmented<Value: Hashable>: View {
    let options: [(value: Value, label: String)]
    @Binding var selection: Value
    var label: String

    var body: some View {
        HStack(spacing: 4) {
            ForEach(options, id: \.value) { option in
                let chosen = option.value == selection
                Button { selection = option.value } label: {
                    Text(option.label)
                        .font(.geist(16, .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .foregroundStyle(Theme.ink)
                        .background {
                            if chosen { Capsule().fill(Theme.surface).cardShadow() }
                        }
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(chosen ? .isSelected : [])
            }
        }
        .padding(4)
        .background(Theme.surfaceAlt, in: .capsule)
        .animation(.easeOut(duration: 0.2), value: selection)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}

/// An amount typed next to its unit, underlined in orange (`.amount-entry`).
struct AmountEntry: View {
    let unit: String
    @Binding var text: String
    let label: String
    var placeholder = "0.00"
    var size: CGFloat = 48

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(unit).font(.geist(24, .semibold))
            TextField(placeholder, text: $text)
                .font(.geist(size, .semibold))
                .monospacedDigit()
                .keyboardType(.decimalPad)
                .accessibilityLabel(label)
        }
        .padding(.bottom, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.brand).frame(height: 2) }
    }
}

/// A text field (`.input`): white, 60 tall, a thin border that turns blue while typing.
struct InputField: View {
    let placeholder: String
    @Binding var text: String
    var monospaced = false
    /// What VoiceOver says for the field (its visible label, when it has one).
    var label: String?
    @FocusState private var focused: Bool

    var body: some View {
        TextField(placeholder, text: $text)
            .font(monospaced ? .system(size: 16, design: .monospaced) : Theme.Text.m)
            .accessibilityLabel(label ?? placeholder)
            .focused($focused)
            .padding(.horizontal, 16)
            .frame(minHeight: 60)
            .background(Theme.surface, in: .rect(cornerRadius: Theme.radiusControl))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusControl)
                .strokeBorder(focused ? Theme.focus : Theme.inkSoft, lineWidth: 1))
    }
}

/// A small pill on an app (`.status-chip`): its category, or "Face ID" once approved.
struct StatusChip: View {
    let text: String
    var approved = false

    var body: some View {
        Text(text)
            .font(.geist(13.5, .bold))
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .foregroundStyle(approved ? Theme.protect : Theme.brandText)
            .background(approved ? Theme.protectBg : Theme.brandTint, in: .capsule)
    }
}

/// Lays its items out like words, wrapping to the next line (the web's `flex-wrap`).
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(subviews, width: proposal.width ?? .infinity)
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0,
                      height: rows.last.map { $0.y + $0.height } ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for row in arrange(subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.items {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: bounds.minY + row.y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
        }
    }

    private func arrange(_ subviews: Subviews, width: CGFloat) -> [(items: [Int], y: CGFloat, width: CGFloat, height: CGFloat)] {
        var rows: [(items: [Int], y: CGFloat, width: CGFloat, height: CGFloat)] = []
        var current: [Int] = [], x: CGFloat = 0, y: CGFloat = 0, height: CGFloat = 0
        for (index, subview) in subviews.enumerated() {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width {
                rows.append((current, y, x - spacing, height))
                y += height + spacing
                current = []; x = 0; height = 0
            }
            current.append(index)
            x += size.width + spacing
            height = max(height, size.height)
        }
        if !current.isEmpty { rows.append((current, y, x - spacing, height)) }
        return rows
    }
}

/// An icon of the web's set before a text, 8 apart (`.protected`, labels on buttons).
struct IconLabel: View {
    let text: String
    let icon: String
    var size: CGFloat = 20

    init(_ text: String, icon: String, size: CGFloat = 20) {
        self.text = text
        self.icon = icon
        self.size = size
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Icon(icon, size: size).alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 6 }
            Text(text)
        }
    }
}

/// A payment slip (`.slip`): the amount on top, a dashed line, then the details, and an optional note.
struct Slip<Head: View, Details: View>: View {
    var note: String?
    @ViewBuilder let head: Head
    @ViewBuilder let details: Details

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) { head }
                .padding(20)
            Line()
                .stroke(Theme.inkSoft, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .frame(height: 1)
            VStack(spacing: 10) { details }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, note == nil ? 20 : 12)
            if let note { Text(note).smallMuted().padding(.horizontal, 20).padding(.bottom, 16) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: .rect(cornerRadius: Theme.radiusPanel))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusPanel).strokeBorder(Theme.line, lineWidth: 1))
        .cardShadow(.m)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Payment details")
    }

}

/// A horizontal line across its frame, for dashed separators.
nonisolated private struct Line: Shape {
    func path(in rect: CGRect) -> Path {
        Path { $0.move(to: CGPoint(x: 0, y: rect.midY)); $0.addLine(to: CGPoint(x: rect.maxX, y: rect.midY)) }
    }
}

/// "Mock" and what is simulated, as the web's small muted line that starts with a Mock tag.
struct MockNote: View {
    let text: String
    var tag = "Mock"

    init(_ text: String, tag: String = "Mock") {
        self.text = text
        self.tag = tag
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            MockTag(text: tag)
            Text(text).smallMuted()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
