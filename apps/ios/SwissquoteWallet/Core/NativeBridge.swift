import Foundation

/// What the wallet core asks of the phone (docs/ios-plan.md, "Native side of the bridge"). Params and
/// answers are JSON objects; bytes are hex.
final class NativeBridge {
    private let storage = Storage()
    private let recoveryKey = RecoveryKeySession()

    func handle(_ method: String, _ params: [String: Any]) async throws -> [String: Any] {
        func text(_ key: String) throws -> String {
            guard let value = params[key] as? String else { throw NativeError("The request is missing \(key).") }
            return value
        }

        switch method {
        case "faceId.create":
            let key = try await FaceIdKey.create(reason: "Create the key to your safe")
            return ["keyId": key.keyId, "publicKey": key.publicKey]
        case "faceId.sign":
            let signature = try await FaceIdKey.sign(keyId: try text("keyId"), message: try Hex.decode(try text("message")),
                                                     reason: params["reason"] as? String ?? "Confirm this payment")
            return ["signature": Hex.encode(signature)]
        case "faceId.confirm":
            try await FaceIdKey.confirm(reason: params["reason"] as? String ?? "Open your safe")
            return [:]

        case "vault.save":
            try Vault.save(walletId: try text("walletId"), mpcShare: try text("mpcShare"), pocketKey: try text("pocketKey"))
            return [:]
        case "vault.unlock":
            let secrets = try await Vault.unlock(walletId: try text("walletId"), reason: params["reason"] as? String ?? "Open your safe")
            return ["mpcShare": secrets.mpcShare, "pocketKey": secrets.pocketKey]
        case "device.forget":
            Vault.deleteAll()
            FaceIdKey.deleteAll()
            return [:]

        case "storage.get":
            return ["value": storage.get(try text("key")) as Any? ?? NSNull()]
        case "storage.set":
            storage.set(try text("key"), try text("value"))
            return [:]
        case "storage.del":
            storage.delete(try text("key"))
            return [:]

        case "recoveryKey.register", "recoveryKey.authenticate":
            let mode: RecoveryKeySession.Mode = method == "recoveryKey.register" ? .register : .authenticate
            let response = try await recoveryKey.run(mode, options: params["options"] ?? NSNull())
            return ["response": response]

        default:
            throw NativeError("The phone cannot do \(method).")
        }
    }
}

struct NativeError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

enum Hex {
    static func encode(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    static func decode(_ text: String) throws -> Data {
        let digits = text.hasPrefix("0x") ? Array(text.dropFirst(2).utf8) : Array(text.utf8)
        guard digits.count % 2 == 0 else { throw NativeError("Invalid hex.") }
        var data = Data(capacity: digits.count / 2)
        for i in stride(from: 0, to: digits.count, by: 2) {
            guard let byte = UInt8(String(decoding: digits[i..<i + 2], as: UTF8.self), radix: 16) else { throw NativeError("Invalid hex.") }
            data.append(byte)
        }
        return data
    }
}
