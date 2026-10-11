import Foundation
import WebKit

/// Serves `sqw://core/…` to the hidden web view: the wallet core's files from the app bundle, and the
/// services under the same origin, as the Next.js rewrites do for the web app (no CORS, one address):
///
/// - `/svc/cosigner/*` → Swissquote co-signer, `/svc/recovery/*` → recovery provider (both through the
///   Next.js server's forwarding), `/api/*` → the Next.js server (`/api/price`, `/api/assistant`)
/// - anything else      → `core/` in the app bundle (index.html, wallet-core.js, dkls.wasm)
final class CoreSchemeHandler: NSObject, WKURLSchemeHandler {
    /// Read at each request: the server address can change in the Demo panel.
    private static var routes: [(prefix: String, target: URL)] {
        [
            ("/svc/cosigner/", AppConfig.cosignerURL),
            ("/svc/recovery/", AppConfig.recoveryURL),
            ("/api/", AppConfig.webURL.appending(path: "api/")),
        ]
    }

    private static let contentTypes = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "wasm": "application/wasm",
        "map": "application/json",
    ]

    private let session = URLSession(configuration: .ephemeral)
    /// Tasks WebKit has stopped: answering them would crash, so their answers are dropped.
    private var stopped = Set<ObjectIdentifier>()

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url else { return fail(task, URLError(.badURL)) }
        if let route = Self.routes.first(where: { url.path.hasPrefix($0.prefix) }) {
            proxy(task, to: route.target, path: String(url.path.dropFirst(route.prefix.count)), query: url.query)
        } else {
            serveFile(task, path: url.path)
        }
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }

    // MARK: - Bundle files

    private func serveFile(_ task: any WKURLSchemeTask, path: String) {
        let name = path == "/" ? "index.html" : String(path.drop(while: { $0 == "/" }))
        guard !name.contains(".."),
              let root = Bundle.main.resourceURL?.appending(path: "core"),
              let data = try? Data(contentsOf: root.appending(path: name))
        else {
            return respond(task, status: 404, headers: ["Content-Type": "text/plain"], body: Data("Not found".utf8))
        }
        let type = Self.contentTypes[(name as NSString).pathExtension] ?? "application/octet-stream"
        respond(task, status: 200, headers: ["Content-Type": type, "Cache-Control": "no-store"], body: data)
    }

    // MARK: - Services

    private func proxy(_ task: any WKURLSchemeTask, to base: URL, path: String, query: String?) {
        var components = URLComponents(url: base.appending(path: path), resolvingAgainstBaseURL: false)!
        components.percentEncodedQuery = query
        var request = URLRequest(url: components.url!)
        request.httpMethod = task.request.httpMethod ?? "GET"
        request.httpBody = task.request.httpBody ?? task.request.httpBodyStream.map(Self.read)
        for (name, value) in task.request.allHTTPHeaderFields ?? [:] where name.lowercased() != "origin" {
            request.setValue(value, forHTTPHeaderField: name)
        }
        Task {
            do {
                let (data, response) = try await session.data(for: request)
                let http = response as? HTTPURLResponse
                var headers = [String: String]()
                for (name, value) in http?.allHeaderFields ?? [:] {
                    // URLSession has already decoded the body.
                    if let name = name as? String, name.lowercased() != "content-encoding", name.lowercased() != "content-length" {
                        headers[name] = "\(value)"
                    }
                }
                respond(task, status: http?.statusCode ?? 502, headers: headers, body: data)
            } catch {
                let message = #"{"error":"The Swissquote services at \#(AppConfig.serverName) are not reachable."}"#
                respond(task, status: 502, headers: ["Content-Type": "application/json"], body: Data(message.utf8))
            }
        }
    }

    private static func read(_ stream: InputStream) -> Data {
        var data = Data()
        stream.open()
        defer { stream.close() }
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }

    // MARK: - Answers

    private func respond(_ task: any WKURLSchemeTask, status: Int, headers: [String: String], body: Data) {
        guard stopped.remove(ObjectIdentifier(task)) == nil else { return }
        var headers = headers
        headers["Content-Length"] = String(body.count)
        let response = HTTPURLResponse(url: task.request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }

    private func fail(_ task: any WKURLSchemeTask, _ error: any Error) {
        guard stopped.remove(ObjectIdentifier(task)) == nil else { return }
        task.didFailWithError(error)
    }
}
