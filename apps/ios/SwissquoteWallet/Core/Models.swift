import Foundation

// What the screens read from the wallet core. Objects the core takes back (a contact, the profile's
// passkey) keep their JSON as the core sent it, so Swift never rebuilds them.

nonisolated struct Client: Codable, Equatable {
    var name: String
    var clientNumber: String

    static let demo = Client(name: "Elisabeth Keller", clientNumber: "CH-4417-2093")

    var firstName: String { name.split(separator: " ").first.map(String.init) ?? name }
    var initials: String { String(name.split(separator: " ").compactMap(\.first).prefix(2)) }
}

nonisolated struct WalletProfile: Decodable, Equatable {
    let walletId: String
    let client: Client
    let savingsAddress: String
    let pocketAddress: String
    /// The Face ID key's record, passed back to the core unchanged.
    let passkey: JSONValue
}

/// An approved contact from the rulebook. Encodes back to exactly the JSON the core sent.
nonisolated struct Contact: Codable, Identifiable, Equatable {
    let json: JSONValue
    var id: String { json["id"].string ?? name }
    var name: String { json["name"].string ?? "?" }
    var relation: String { json["relation"].string ?? "" }
    var canReceiveBitcoin: Bool { json["btcAddress"].string != nil }
    var canReceiveUsdc: Bool { json["ethAddress"].string != nil }

    init(json: JSONValue) { self.json = json }
    init(from decoder: any Decoder) throws { json = try JSONValue(from: decoder) }
    func encode(to encoder: any Encoder) throws { try json.encode(to: encoder) }
}

nonisolated struct PriceQuote: Decodable, Equatable {
    let btcChf: Double
    let ethChf: Double
    let usdcChf: Double
    /// True when the live price is unavailable and fixed demo values are used.
    let mock: Bool
}

/// A bigint amount from the core (satoshis, USDC units, wei), sent as a decimal string.
nonisolated struct Units: Codable, Comparable, Hashable {
    let value: Int64

    init(_ value: Int64) { self.value = value }

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let text = try? container.decode(String.self) {
            // Wei can exceed Int64: those amounts are only displayed, so they are capped rather than rejected.
            value = Int64(text) ?? (Double(text).map { $0 >= 9.2e18 ? Int64.max : Int64($0) } ?? 0)
        } else {
            value = try container.decode(Int64.self)
        }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(String(value))
    }

    static func < (a: Units, b: Units) -> Bool { a.value < b.value }
    static func + (a: Units, b: Units) -> Units { Units(a.value + b.value) }
    static func - (a: Units, b: Units) -> Units { Units(a.value - b.value) }
    static let zero = Units(0)
}

nonisolated struct Balance: Decodable {
    let confirmed: Units
    let pending: Units
    var total: Units { confirmed + pending }
}

nonisolated struct Balances: Decodable {
    let pocket: Balance
    let savings: Balance
}

/// A Swissquote check (scam shield): APPROVE, NEEDS_CONFIRMATION or BLOCKED, with reasons in plain language.
nonisolated struct Review: Decodable, Equatable {
    let verdict: String
    let reasons: [String]
}

/// A Bitcoin payment prepared by the core; `handle` sends it.
nonisolated struct PreparedPayment: Decodable {
    nonisolated struct Draft: Decodable {
        nonisolated struct Spend: Decodable {
            let amount: Units
            let fee: Units
            let paidBy: String
        }
        let spend: Spend
        let feeNote: String?
    }

    let handle: String
    let contact: Contact
    /// "pocket" or "savings".
    let from: String
    let draft: Draft
    let review: Review?
    /// "swissquote" or "recovery-provider" (Swissquote offline).
    let via: String?
}

nonisolated struct PaymentResult: Decodable {
    nonisolated struct Refill: Decodable {
        let txid: String?
        let amount: Units?
        let error: String?
    }
    let txid: String
    let refill: Refill?
}
