import Foundation
import Observation

/// The Mock Swissquote login and the safe on this phone, as the web app's `WalletProvider` keeps them,
/// plus the indicative price (refreshed every minute).
@Observable
final class Session {
    private(set) var loading = true
    private(set) var client: Client?
    private(set) var profile: WalletProfile?
    private(set) var price: PriceQuote?

    @ObservationIgnored let core: WalletCore

    init(core: WalletCore) {
        self.core = core
    }

    func reload() async {
        do {
            client = try await core.call("client.load", as: Client?.self)
            profile = try await core.call("profile.load", as: WalletProfile?.self)
        } catch {
            client = nil
            profile = nil
        }
        loading = false
    }

    func logIn(_ client: Client) async throws {
        try await core.call("client.save", client)
        await reload()
    }

    /// Keeps the price fresh while the app runs (the core asks the Next.js server, which asks CoinGecko).
    func followPrice() async {
        while !Task.isCancelled {
            if let quote = try? await core.call("price", as: PriceQuote.self) { price = quote }
            try? await Task.sleep(for: .seconds(60))
        }
    }
}
