// SyncPairing.swift — pair the account signed in on the phone's own studio with the ORIGIN's relay, once, through
// the system browser: the origin mints a device token and redirects it to a loopback port this app listens on,
// and the phone's backend keeps it for that account. Mirrors apps/k7-standalone/src/pairSync.ts. The browser is an
// ASWebAuthenticationSession over the app, so the app stays in front while it waits and closes the sheet itself
// once the answer is in. See engine/k7-runtime/docs/ios.md.

import AuthenticationServices
import Foundation
import os
import UIKit

final class SyncPairing: NSObject, ASWebAuthenticationPresentationContextProviding {
    /// web-protocol's STUDIO_ORIGIN: the server a phone syncs with until the sign-in popin names another.
    private static let defaultOrigin = "https://app.k7.rocks"
    private static let serverKey = "k7.syncServer"
    private static var syncOrigin: String { UserDefaults.standard.string(forKey: serverKey) ?? defaultOrigin }
    private static var syncHost: String { URLComponents(string: syncOrigin)?.host ?? syncOrigin }
    /// web-protocol's SYNC_PAIR_ROUTE and SYNC_PAIR_RETURN_PATH: the origin accepts only an http loopback return.
    private static let pairRoute = "/api/sync/devices/pair"
    private static let returnPath = "/desktop/sync-pair"
    /// A pairing left unfinished in the browser stops listening after this.
    private static let waitSeconds: TimeInterval = 10 * 60

    private static let shared = SyncPairing()
    private let log = Logger(subsystem: "se.frediver.k7", category: "k7-sync")
    private let lock = NSLock()
    // Accounts asked this run: a pairing the person declined is not offered again at every page load.
    private var asked = Set<String>()
    private var busy = false
    private var session: ASWebAuthenticationSession?

    private enum Outcome {
        case paired
        case otherAccount(String?)
        case notStored
    }

    /// Keep the server the sign-in popin named, when it is one: https, or http on this phone only.
    static func choose(_ input: String?) {
        guard let raw = input?.trimmingCharacters(in: .whitespaces), !raw.isEmpty,
              let u = URLComponents(string: raw), let host = u.host?.lowercased(), u.user == nil, u.password == nil else { return }
        let loopback = ["127.0.0.1", "localhost", "::1"].contains(host)
        guard u.scheme == "https" || (u.scheme == "http" && loopback) else { return }
        let origin = u.port.map { "\(u.scheme!)://\(host):\($0)" } ?? "\(u.scheme!)://\(host)"
        UserDefaults.standard.set(origin, forKey: serverKey)
    }

    /// Pair the account signed in to the phone's studio, unless it is the local user, already paired, or asked this run.
    static func pairIfNeeded(cookie: String) {
        shared.launch(cookie: cookie, again: false)
    }

    private func launch(cookie: String, again: Bool) {
        if cookie.isEmpty { return }
        lock.lock()
        if busy {
            lock.unlock()
            return
        }
        busy = true
        lock.unlock()
        Thread { [self] in
            let retry = run(cookie: cookie, again: again)
            lock.lock()
            busy = false
            lock.unlock()
            if retry { launch(cookie: cookie, again: true) }
        }.start()
    }

    /// One pairing, start to end, on this thread; true when the person asked to try again.
    private func run(cookie: String, again: Bool) -> Bool {
        guard let user = local("GET", "/auth/me", cookie: cookie)?["user"] as? [String: Any],
              let email = user["email"] as? String, !email.isEmpty,
              user["local"] as? Bool != true else { return false }
        lock.lock()
        let fresh = asked.insert(email).inserted
        lock.unlock()
        if !again && !fresh { return false }
        guard let remote = local("GET", "/api/sync/remote", cookie: cookie) else { return false }
        // Already a server of this account, main or not, as on desktop: another one chosen is paired as the main.
        let servers = remote["servers"] as? [[String: Any]] ?? []
        let hosts = servers.compactMap { s in (s["url"] as? String).flatMap { url in URLComponents(string: url)?.host } }
        if hosts.contains(Self.syncHost) { return false }
        if !again && !Dialogs.ask(
            "Sync",
            "Sync this phone's workspaces with \(Self.syncHost)?\n\nThe browser opens to confirm it as \(email).",
            yes: "Sync", no: "Not now"
        ) { return false }
        guard let server = Loopback() else {
            Dialogs.tell("This phone's sync pairing could not listen for the browser's answer.")
            return false
        }
        defer { server.close() }
        var bytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let state = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        var url = URLComponents(string: Self.syncOrigin + Self.pairRoute)!
        url.queryItems = [
            URLQueryItem(name: "return", value: "http://127.0.0.1:\(server.port)\(Self.returnPath)"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "name", value: Self.deviceName()),
        ]
        DispatchQueue.main.async { self.openBrowser(url.url!) }
        let outcome = listen(server, state: state, email: email, cookie: cookie)
        DispatchQueue.main.async {
            self.session?.cancel()
            self.session = nil
        }
        return report(outcome, email: email)
    }

    private func openBrowser(_ url: URL) {
        // No callback scheme: the answer comes to the loopback port, and this app closes the sheet when it does.
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: nil) { _, _ in }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        self.session = session
        if !session.start() { log.warning("the pairing browser did not open") }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        Dialogs.top()?.view.window ?? ASPresentationAnchor()
    }

    private func listen(_ server: Loopback, state: String, email: String, cookie: String) -> Outcome? {
        let until = Date().addingTimeInterval(Self.waitSeconds)
        while Date() < until {
            guard let client = server.accept(timeout: until.timeIntervalSinceNow) else { continue }
            defer { close(client) }
            if let outcome = answer(client, state: state, email: email, cookie: cookie) { return outcome }
        }
        return nil
    }

    /// One request on the listener; the outcome once the pairing is settled either way, nil for a stray request.
    private func answer(_ client: Int32, state: String, email: String, cookie: String) -> Outcome? {
        guard let line = Loopback.requestLine(client), let target = line.split(separator: " ").dropFirst().first,
              let u = URLComponents(string: "http://127.0.0.1\(target)") else { return nil }
        let query = { (name: String) in u.queryItems?.first(where: { $0.name == name })?.value ?? "" }
        guard u.path == Self.returnPath, query("state") == state else {
            Loopback.reply(client, 404, "Not found")
            return nil
        }
        // The browser may be signed in to the origin as someone else: their token must not sync this account.
        let identity = query("identity")
        if identity != email {
            log.warning("sync pairing refused: the browser is signed in as another account")
            Loopback.reply(client, 409, "This browser is signed in to \(Self.syncHost) as another account than the phone's, so nothing was paired. Go back to k7: it says what to do.")
            return .otherAccount(identity)
        }
        let relay = query("url")
        let token = query("token")
        let stored = local("PUT", "/api/sync/remote", cookie: cookie, body: ["url": relay, "token": token]) != nil
        // The same token lists this phone's engine at that studio, which may admit paired machines only.
        if stored { SupervisorHost.shared.rememberDeviceToken(origin: Self.originOf(relay), token: token) }
        Loopback.reply(client, stored ? 200 : 500, stored
            ? "This phone now syncs your workspaces. You can go back to k7."
            : "The pairing could not be stored on this phone. Go back to k7.")
        return stored ? .paired : .notStored
    }

    /// What the person is told; true when they asked to try again.
    private func report(_ outcome: Outcome?, email: String) -> Bool {
        switch outcome {
        case .none:
            Dialogs.tell("The sync pairing was not finished in the browser. k7 will offer it again at its next start.")
        case .paired:
            Dialogs.tell("This phone now syncs its workspaces with \(Self.syncHost).")
        case .notStored:
            Dialogs.tell("The sync pairing could not be saved on this phone. k7 will offer it again at its next start.")
        case .otherAccount(let browserAs):
            let who = (browserAs?.isEmpty == false) ? "as \(browserAs!)" : "as another account"
            return Dialogs.ask(
                "Sync",
                "Nothing was paired: the browser is signed in to \(Self.syncHost) \(who), and this phone is signed in as \(email).\n\nSign in to \(Self.syncHost) in the browser as \(email), then try again.",
                yes: "Try again", no: "Not now"
            )
        }
        return false
    }

    /// `wss://host/api/sync` as the studio's origin, `https://host`: the key the supervisor's registry list uses.
    private static func originOf(_ relay: String) -> String {
        guard let u = URLComponents(string: relay), let host = u.host else { return "" }
        let scheme = u.scheme == "ws" ? "http" : "https"
        return u.port.map { "\(scheme)://\(host):\($0)" } ?? "\(scheme)://\(host)"
    }

    /// The phone's backend, as the signed-in account: its session cookie, read from the views' cookie store.
    private func local(_ method: String, _ path: String, cookie: String, body: [String: Any]? = nil) -> [String: Any]? {
        var request = URLRequest(url: URL(string: BackendHost.origin + path)!)
        request.httpMethod = method
        // A PUT restarts the account's file service before it answers.
        request.timeoutInterval = 60
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        let done = DispatchSemaphore(value: 0)
        var out: [String: Any]?
        URLSession.shared.dataTask(with: request) { data, response, _ in
            if let code = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(code), let data {
                out = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            }
            done.signal()
        }.resume()
        done.wait()
        return out
    }

    /// What the origin's device list shows: the phone's model as iOS names it to an app.
    private static func deviceName() -> String {
        DispatchQueue.main.sync { UIDevice.current.model }
    }
}

/// A TCP listener on 127.0.0.1 only, at a port of the system's choosing.
private final class Loopback {
    let fd: Int32
    let port: Int

    init?() {
        let s = socket(AF_INET, SOCK_STREAM, 0)
        guard s >= 0 else { return nil }
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        addr.sin_port = 0
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        let bound = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(s, $0, len) } }
        guard bound == 0, listen(s, 4) == 0 else {
            Darwin.close(s)
            return nil
        }
        _ = withUnsafeMutablePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(s, $0, &len) } }
        fd = s
        port = Int(UInt16(bigEndian: addr.sin_port))
    }

    /// The next connection, or nil after `timeout` seconds without one.
    func accept(timeout: TimeInterval) -> Int32? {
        var p = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
        guard poll(&p, 1, Int32(max(0, min(timeout, 60)) * 1000)) > 0 else { return nil }
        let client = Darwin.accept(fd, nil, nil)
        return client >= 0 ? client : nil
    }

    func close() { Darwin.close(fd) }

    /// The request's first line, read within ten seconds.
    static func requestLine(_ client: Int32) -> String? {
        var tv = timeval(tv_sec: 10, tv_usec: 0)
        setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        var got = Data()
        var byte: UInt8 = 0
        while got.count < 8192, read(client, &byte, 1) == 1 {
            if byte == 0x0A { break }
            if byte != 0x0D { got.append(byte) }
        }
        return got.isEmpty ? nil : String(decoding: got, as: UTF8.self)
    }

    static func reply(_ client: Int32, _ status: Int, _ said: String) {
        let escaped = said.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        let body = Data(("<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\">" +
            "<title>k7</title><body style=\"font:16px system-ui;background:#101114;color:#e4e4e7;padding:24px\"><p>" +
            escaped + "</p>").utf8)
        let head = "HTTP/1.1 \(status) \(status == 200 ? "OK" : "Error")\r\nContent-Type: text/html; charset=utf-8\r\n" +
            "Content-Length: \(body.count)\r\nConnection: close\r\n\r\n"
        for chunk in [Data(head.utf8), body] {
            _ = chunk.withUnsafeBytes { write(client, $0.baseAddress, chunk.count) }
        }
    }
}
