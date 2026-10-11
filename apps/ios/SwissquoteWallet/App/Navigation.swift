import Observation
import SwiftUI

/// The app's sections and the screens pushed from Home.
@Observable
final class Navigation {
    enum Tab: Hashable { case home, explore, assistant, send, rules }

    var tab = Tab.home
    var homePath = NavigationPath()

    /// Back to Home, nothing pushed (after "Lose this phone", or when the safe changes).
    func reset() {
        tab = .home
        homePath = NavigationPath()
    }
}

/// Screens pushed from Home (and the brand bar's Demo panel).
enum Route: Hashable {
    case receive, activity, alerts, settings, demo, recoveryKey
}
