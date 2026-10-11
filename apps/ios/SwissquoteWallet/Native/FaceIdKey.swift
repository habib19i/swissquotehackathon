import CryptoKit
import Foundation
import LocalAuthentication
import Security

/// The WALLET passkey: a P-256 key in the phone's Secure Enclave that only Face ID can use. It never
/// leaves the Secure Enclave; the Keychain keeps only its encrypted handle (`dataRepresentation`).
///
/// On a device the key carries `.biometryCurrentSet`: the Secure Enclave itself refuses to sign without
/// Face ID, and a new face enrolled on the phone makes the key unusable. The iOS Simulator has a Secure
/// Enclave but refuses keys bound to Face ID ("not supported on iOS Simulator", checked on Xcode 27), so
/// there the key is a plain Secure Enclave key and the app asks Face ID before each use.
enum FaceIdKey {
    /// False in the Simulator: Face ID is then checked by the app, not by the Secure Enclave.
    static let enforcedBySecureEnclave: Bool = {
        #if targetEnvironment(simulator)
        false
        #else
        true
        #endif
    }()

    private static let service = "ch.swissquote.wallet.face-id-key"

    /// Asks Face ID, then creates the key. Returns its id and its uncompressed public point (hex, 65 bytes).
    static func create(reason: String) async throws -> (keyId: String, publicKey: String) {
        let context = try await authenticate(reason: reason)
        guard SecureEnclave.isAvailable else { throw NativeError("This phone has no Secure Enclave.") }
        let key = try SecureEnclave.P256.Signing.PrivateKey(accessControl: try accessControl(), authenticationContext: context)
        let keyId = UUID().uuidString
        try Keychain.add(service: service, account: keyId, data: key.dataRepresentation, accessible: Keychain.thisDeviceOnly)
        return (keyId, Hex.encode(key.publicKey.x963Representation))
    }

    /// Face ID, then the Secure Enclave signs `message` (CryptoKit hashes it with SHA-256). DER signature.
    static func sign(keyId: String, message: Data, reason: String) async throws -> Data {
        guard let handle = try Keychain.read(service: service, account: keyId) else {
            throw NativeError("This phone does not hold the Face ID key for this safe.")
        }
        return try await signInEnclave(handle: handle, message: message, context: try await authenticate(reason: reason))
    }

    /// Off the main thread: the Secure Enclave can block while it checks the Face ID context.
    @concurrent
    private nonisolated static func signInEnclave(handle: Data, message: Data, context: LAContext) async throws -> Data {
        let key = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: handle, authenticationContext: context)
        return try key.signature(for: message).derRepresentation
    }

    /// A Face ID check with nothing to sign.
    static func confirm(reason: String) async throws {
        _ = try await authenticate(reason: reason)
    }

    static func deleteAll() {
        Keychain.deleteAll(service: service)
    }

    // MARK: -

    private static func accessControl() throws -> SecAccessControl {
        #if targetEnvironment(simulator)
        let flags: SecAccessControlCreateFlags = [.privateKeyUsage]
        #else
        let flags: SecAccessControlCreateFlags = [.privateKeyUsage, .biometryCurrentSet]
        #endif
        var error: Unmanaged<CFError>?
        guard let control = SecAccessControlCreateWithFlags(nil, Keychain.thisDeviceOnly, flags, &error) else {
            throw error!.takeRetainedValue() as any Error
        }
        return control
    }

    /// Face ID with the app's reason. The same context then opens the key or the vault without asking again.
    static func authenticate(reason: String) async throws -> sending LAContext {
        let context = LAContext()
        context.localizedCancelTitle = "Cancel"
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            throw NativeError(error.map(faceIdMessage) ?? "Face ID is not available on this phone.")
        }
        do {
            try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)
        } catch {
            throw NativeError(faceIdMessage(error as NSError))
        }
        return context
    }

    private static func faceIdMessage(_ error: NSError) -> String {
        switch LAError.Code(rawValue: error.code) {
        case .userCancel, .appCancel, .systemCancel: "cancelled"
        case .biometryNotEnrolled: "Face ID is not set up on this phone. Please set it up in Settings."
        case .biometryLockout: "Face ID is locked. Unlock your phone with its code, then try again."
        case .authenticationFailed: "Face ID did not recognise you."
        default: error.localizedDescription
        }
    }
}
