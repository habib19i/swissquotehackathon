import Foundation

/// Amounts as the web app shows them (apps/web/lib/format.ts, packages/bitcoin/src/units.ts).
enum Format {
    static let satsPerBtc: Int64 = 100_000_000
    /// The default Spending pocket size and daily limit (packages/shared/src/rulebook.ts).
    static let defaultPocketChf: Double = 100

    private static let chfStyle = FloatingPointFormatStyle<Double>.Currency(code: "CHF", locale: Locale(identifier: "de_CH"))

    /// Swiss formatting: CHF 1’234.50
    static func chf(_ amount: Double) -> String { amount.formatted(chfStyle) }

    static func chf(_ sats: Units, btcChf: Double?) -> String {
        guard let btcChf else { return "…" }
        return chf(satsToChf(sats, btcChf: btcChf))
    }

    static func satsToChf(_ sats: Units, btcChf: Double) -> Double {
        Double(sats.value) / Double(satsPerBtc) * btcChf
    }

    /// Rounded down so a CHF amount never turns into more bitcoin than intended.
    static func chfToSats(_ chf: Double, btcChf: Double) -> Units {
        Units(Int64((chf / btcChf * Double(satsPerBtc)).rounded(.down)))
    }

    /// "0.0005 BTC": exact, trailing zeros dropped.
    static func btc(_ sats: Units) -> String {
        let negative = sats.value < 0
        let abs = negative ? -sats.value : sats.value
        let fraction = String(String(abs % satsPerBtc).leftPadded(to: 8).reversed().drop(while: { $0 == "0" }).reversed())
        return "\(negative ? "-" : "")\(abs / satsPerBtc)\(fraction.isEmpty ? "" : ".\(fraction)") BTC"
    }

    /// "USDC 12.50" (6 decimals on chain).
    static func usdc(_ units: Units) -> String {
        "USDC " + (Double(units.value) / 1_000_000).formatted(.number.precision(.fractionLength(2)).locale(Locale(identifier: "en_CH")))
    }

    static func usdcChf(_ units: Units, usdcChf: Double) -> Double {
        Double(units.value) / 1_000_000 * usdcChf
    }

    static func shortId(_ id: String) -> String {
        id.count > 14 ? "\(id.prefix(8))…\(id.suffix(6))" : id
    }

    /// Accepts "12.50", "12,50" and "1’000".
    static func parseChf(_ input: String) -> Double? {
        let cleaned = input.replacingOccurrences(of: ",", with: ".").filter { !"'’ ".contains($0) }
        guard let value = Double(cleaned), value.isFinite else { return nil }
        return value
    }

    static func greeting(at date: Date = Date()) -> String {
        let hour = Calendar.current.component(.hour, from: date)
        return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
    }
}

enum Explorer {
    static func btcTx(_ txid: String) -> URL { URL(string: "https://mempool.space/signet/tx/\(txid)")! }
    static func baseTx(_ hash: String) -> URL { URL(string: "https://sepolia.basescan.org/tx/\(hash)")! }
}

private extension String {
    func leftPadded(to length: Int) -> String {
        count >= length ? self : String(repeating: "0", count: length - count) + self
    }
}
