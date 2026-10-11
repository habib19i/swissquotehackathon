import Foundation
import LocalAuthentication
import Security

/// The phone's secrets: MPC share 1 and the Spending pocket key, as one Keychain item that only Face ID
/// opens, kept on this device only (never in backups or iCloud). Values are hex, as the core sends them.
///
/// On a device the item carries `.biometryCurrentSet`, so the Keychain itself asks for Face ID. The
/// Simulator refuses that flag (as for the Face ID key): there the app asks Face ID before reading.
enum Vault {
    private static let service = "ch.swissquote.wallet.vault"

    private struct Secrets: Codable {
        let mpcShare: String
        let pocketKey: String
    }

    static func save(walletId: String, mpcShare: String, pocketKey: String) throws {
        let data = try JSONEncoder().encode(Secrets(mpcShare: mpcShare, pocketKey: pocketKey))
        // One safe per phone: a new safe (or a recovered one) replaces whatever was there.
        Keychain.deleteAll(service: service)
        #if targetEnvironment(simulator)
        try Keychain.add(service: service, account: walletId, data: data, accessible: Keychain.thisDeviceOnly)
        #else
        var error: Unmanaged<CFError>?
        guard let control = SecAccessControlCreateWithFlags(nil, Keychain.thisDeviceOnly, .biometryCurrentSet, &error) else {
            throw error!.takeRetainedValue() as any Error
        }
        try Keychain.add(service: service, account: walletId, data: data, accessControl: control)
        #endif
    }

    /// Face ID, then the secrets. The core wipes them after use.
    static func unlock(walletId: String, reason: String) async throws -> (mpcShare: String, pocketKey: String) {
        let context = try await FaceIdKey.authenticate(reason: reason)
        guard let data = try Keychain.read(service: service, account: walletId, context: context) else {
            throw NativeError("This phone does not hold a key for this safe")
        }
        let secrets = try JSONDecoder().decode(Secrets.self, from: data)
        return (secrets.mpcShare, secrets.pocketKey)
    }

    static func deleteAll() {
        Keychain.deleteAll(service: service)
    }
}

/// Generic-password Keychain items, this device only.
enum Keychain {
    /// This device only, never in backups. A device also needs a passcode (Face ID implies one); the
    /// Simulator has none, so there the item only needs the phone unlocked.
    static let thisDeviceOnly: CFString = {
        #if targetEnvironment(simulator)
        kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        #else
        kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly
        #endif
    }()

    static func add(service: String, account: String, data: Data, accessible: CFString) throws {
        try add([kSecAttrService: service, kSecAttrAccount: account, kSecValueData: data, kSecAttrAccessible: accessible])
    }

    static func add(service: String, account: String, data: Data, accessControl: SecAccessControl) throws {
        try add([kSecAttrService: service, kSecAttrAccount: account, kSecValueData: data, kSecAttrAccessControl: accessControl])
    }

    private static func add(_ attributes: [CFString: Any]) throws {
        var query = attributes
        query[kSecClass] = kSecClassGenericPassword
        SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: attributes[kSecAttrService]!,
                       kSecAttrAccount: attributes[kSecAttrAccount]!] as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw NativeError("The phone could not store this securely (Keychain \(status)).") }
    }

    static func read(service: String, account: String, context: LAContext? = nil) throws -> Data? {
        var query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service,
                                      kSecAttrAccount: account, kSecReturnData: true]
        if let context { query[kSecUseAuthenticationContext] = context }
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess: return result as? Data
        case errSecItemNotFound: return nil
        case errSecUserCanceled: throw NativeError("cancelled")
        default: throw NativeError("The phone could not open this securely (Keychain \(status)).")
        }
    }

    static func deleteAll(service: String) {
        SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: service] as CFDictionary)
    }
}
