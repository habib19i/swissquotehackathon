import Foundation

/// The core's storage (the web app's `idb-keyval`): public data only (the Mock login, the safe's profile,
/// the rulebook cache). Secrets go to the `Vault`, never here.
struct Storage {
    private let defaults = UserDefaults.standard
    private let prefix = "sqw.core."

    func get(_ key: String) -> String? { defaults.string(forKey: prefix + key) }
    func set(_ key: String, _ value: String) { defaults.set(value, forKey: prefix + key) }
    func delete(_ key: String) { defaults.removeObject(forKey: prefix + key) }
}
