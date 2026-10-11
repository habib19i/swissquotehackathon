import SwiftUI

/// The app's main sections at thumb height (apps/web/components/tab-bar.tsx); the assistant sits in the
/// middle, raised and orange.
struct TabBar: View {
    @Environment(Navigation.self) private var navigation

    private static let tabs: [(tab: Navigation.Tab, label: String, icon: String, raised: Bool)] = [
        (.home, "Home", "home", false),
        (.explore, "Explore", "compass", false),
        (.assistant, "Assistant", "chat", true),
        (.send, "Send", "send", false),
        (.rules, "Rules", "rules", false),
    ]

    var body: some View {
        HStack(alignment: .bottom, spacing: 0) {
            ForEach(Self.tabs, id: \.label) { item in
                let active = navigation.tab == item.tab
                Button {
                    if active, item.tab == .home { navigation.homePath = NavigationPath() }
                    navigation.tab = item.tab
                } label: {
                    VStack(spacing: 4) {
                        if item.raised {
                            Icon(item.icon, size: 26)
                                .frame(width: 60, height: 60)
                                .foregroundStyle(Theme.onBrand)
                                .background(Theme.brand, in: .circle)
                                .overlay(Circle().strokeBorder(Theme.surface, lineWidth: 5).padding(-5))
                                .shadow(color: Theme.brand.opacity(0.6), radius: 10, y: 10)
                                .padding(.top, -32)
                        } else {
                            Icon(item.icon, size: 24).foregroundStyle(active ? Theme.brand : Theme.inkSoft)
                        }
                        Text(item.label)
                            .font(.geist(14.4, active ? .bold : .medium))
                            .foregroundStyle(active ? Theme.brandText : Theme.inkSoft)
                    }
                    .frame(maxWidth: .infinity, minHeight: 56, alignment: .bottom)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 10)
        .padding(.bottom, 10)
        .background {
            UnevenRoundedRectangle(topLeadingRadius: 28, topTrailingRadius: 28)
                .fill(Theme.surface)
                .shadow(color: Color.black.opacity(0.12), radius: 12, y: -8)
                .ignoresSafeArea(edges: .bottom)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Main")
    }
}
