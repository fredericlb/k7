// SyncPairing.swift — pair the account signed in on the phone's own studio with the ORIGIN's relay, once. The pairing
// itself is the phone's backend's (packages/file-hub/pairRoutes.ts, Android's and the desktop's too): this asks it
// whether to offer one, asks the person, opens the URL it answers when it answers one (the backend pairs at once when
// the phone's sign-in is proof enough), and says how it ended. The browser is an ASWebAuthenticationSession over the app; the token comes back to the backend's own port,
// and the app closes the sheet itself once the backend says the pairing ended. The link takes whichever account the
// browser confirms on the server, the phone's own or another. See engine/k7-runtime/docs/ios.md.

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
    /// The phone's backend's pairing routes (packages/file-hub/pairRoutes.ts).
    private static let pairApi = "/api/sync/remote/pair"
    /// One long poll of the backend while the browser is in front, in ms.
    private static let pollMs = 25_000

    private static let shared = SyncPairing()
    private let log = Logger(subsystem: "se.frediver.k7", category: "k7-sync")
    private let lock = NSLock()
    // Accounts asked this run: a pairing the person declined is not offered again at every page load.
    private var asked = Set<String>()
    private var busy = false
    private var session: ASWebAuthenticationSession?

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
        shared.launch(cookie: cookie)
    }

    private func launch(cookie: String) {
        if cookie.isEmpty { return }
        lock.lock()
        if busy {
            lock.unlock()
            return
        }
        busy = true
        lock.unlock()
        Thread { [self] in
            run(cookie: cookie)
            lock.lock()
            busy = false
            lock.unlock()
        }.start()
    }

    /// One pairing, start to end, on this thread.
    private func run(cookie: String) {
        let query = Self.syncOrigin.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        guard let offer = local("GET", "\(Self.pairApi)?origin=\(query)", cookie: cookie),
              let email = offer["email"] as? String, !email.isEmpty,
              offer["local"] as? Bool != true else { return }
        lock.lock()
        let fresh = asked.insert(email).inserted
        lock.unlock()
        if let pairing = offer["pairing"] as? [String: Any], let state = pairing["state"] as? String {
            // Ended while nobody was here to say so: said now. Still waiting, its sheet died with the app: dropped.
            if pairing["phase"] as? String != "waiting" {
                settle(pairing, cookie: cookie)
                return
            }
            _ = local("DELETE", "\(Self.pairApi)/\(state)", cookie: cookie)
        }
        if !fresh { return }
        // Offered only while no server is saved: adding and switching servers is the settings' (ios.md).
        if (offer["links"] as? Int ?? 0) > 0 { return }
        // The backend pairs at once when the phone's sign-in is proof enough for that server (packages/file-hub/docs/syncRelay.md).
        let question = offer["direct"] as? Bool == true
            ? "Sync this phone's workspaces with \(Self.syncHost) as \(email)?"
            : "Sync this phone's workspaces with \(Self.syncHost)?\n\nThe browser opens to confirm the account there: \(email), or another one."
        if !Dialogs.ask("Sync", question, yes: "Sync", no: "Not now") { return }
        let body: [String: Any] = ["origin": Self.syncOrigin, "name": Self.deviceName()]
        guard let started = local("POST", Self.pairApi, cookie: cookie, body: body),
              let pairing = started["pairing"] as? [String: Any] else {
            Dialogs.tell("This phone's sync pairing could not start. k7 will offer it again at its next start.")
            return
        }
        // Paired already, with no browser: said at once.
        if pairing["phase"] as? String != "waiting" {
            settle(pairing, cookie: cookie)
            return
        }
        guard let link = (started["url"] as? String).flatMap(URL.init(string:)) else {
            Dialogs.tell("This phone's sync pairing could not start. k7 will offer it again at its next start.")
            return
        }
        DispatchQueue.main.async { self.openBrowser(link) }
        settle(pairing, cookie: cookie)
        DispatchQueue.main.async {
            self.session?.cancel()
            self.session = nil
        }
    }

    private func openBrowser(_ url: URL) {
        // No callback scheme: the answer comes to the backend's port, and this app closes the sheet when it has.
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: nil) { _, _ in }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        self.session = session
        if !session.start() { log.warning("the pairing browser did not open") }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        Dialogs.top()?.view.window ?? ASPresentationAnchor()
    }

    /// Wait on the backend for the pairing's ending, say it, and let the backend drop it.
    private func settle(_ first: [String: Any], cookie: String) {
        let state = first["state"] as? String ?? ""
        var p = first
        while p["phase"] as? String == "waiting" {
            guard let next = local("GET", "\(Self.pairApi)/\(state)?wait=\(Self.pollMs)", cookie: cookie)?["pairing"] as? [String: Any] else {
                Dialogs.tell("The sync pairing was interrupted. k7 will offer it again at its next start.")
                return
            }
            p = next
        }
        _ = local("DELETE", "\(Self.pairApi)/\(state)", cookie: cookie)
        let host = p["host"] as? String ?? Self.syncHost
        log.info("sync pairing with \(host, privacy: .public): \(p["phase"] as? String ?? "", privacy: .public)")
        // The server's account it ended as: the browser's, else the phone's own.
        let browserAs = p["browserAs"] as? String ?? ""
        let account = browserAs.isEmpty ? (p["email"] as? String ?? "") : browserAs
        switch p["phase"] as? String {
        case "paired":
            // The same token lists this phone's engine at that studio, which may admit paired machines only.
            SupervisorHost.shared.rememberDeviceToken(origin: p["origin"] as? String ?? "", token: p["token"] as? String ?? "")
            Dialogs.tell("This phone now syncs its workspaces with \(host) as \(account).")
        // That account on that server is linked already: the link it has stays.
        case "alreadyLinked", "otherAccount":
            Dialogs.tell("This phone already syncs with \(host) as \(account), so nothing changed.")
        case "expired":
            Dialogs.tell("The sync pairing was not finished in the browser. k7 will offer it again at its next start.")
        default:
            Dialogs.tell("The sync pairing could not be saved on this phone. k7 will offer it again at its next start.")
        }
    }

    /// The phone's backend, as the signed-in account: its session cookie, read from the views' cookie store.
    private func local(_ method: String, _ path: String, cookie: String, body: [String: Any]? = nil) -> [String: Any]? {
        var request = URLRequest(url: URL(string: BackendHost.origin + path)!)
        request.httpMethod = method
        // Longer than one long poll of a pairing under way.
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
