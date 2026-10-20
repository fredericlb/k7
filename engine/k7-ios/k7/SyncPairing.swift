// SyncPairing.swift — pair the account signed in on the phone's own studio with the ORIGIN's relay, once, through
// the system browser. The pairing itself is the phone's backend's (packages/file-hub/pairRoutes.ts, Android's and
// the desktop's too): this asks it whether to offer one, asks the person, opens the URL it answers, and says how it
// ended. The browser is an ASWebAuthenticationSession over the app; the token comes back to the backend's own port,
// and the app closes the sheet itself once the backend says the pairing ended. See engine/k7-runtime/docs/ios.md.

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
        let query = Self.syncOrigin.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        guard let offer = local("GET", "\(Self.pairApi)?origin=\(query)", cookie: cookie),
              let email = offer["email"] as? String, !email.isEmpty,
              offer["local"] as? Bool != true else { return false }
        lock.lock()
        let fresh = asked.insert(email).inserted
        lock.unlock()
        if let pairing = offer["pairing"] as? [String: Any], let state = pairing["state"] as? String {
            // Ended while nobody was here to say so: said now. Still waiting, its sheet died with the app: dropped.
            if pairing["phase"] as? String != "waiting" { return settle(pairing, cookie: cookie) }
            _ = local("DELETE", "\(Self.pairApi)/\(state)", cookie: cookie)
        }
        if !again && !fresh { return false }
        // Already a server of this account, main or not, as on desktop: another one chosen is paired as the main.
        if offer["paired"] as? Bool == true { return false }
        if !again && !Dialogs.ask(
            "Sync",
            "Sync this phone's workspaces with \(Self.syncHost)?\n\nThe browser opens to confirm it as \(email).",
            yes: "Sync", no: "Not now"
        ) { return false }
        let body: [String: Any] = ["origin": Self.syncOrigin, "name": Self.deviceName()]
        guard let started = local("POST", Self.pairApi, cookie: cookie, body: body),
              let pairing = started["pairing"] as? [String: Any],
              let link = (started["url"] as? String).flatMap(URL.init(string:)) else {
            Dialogs.tell("This phone's sync pairing could not start. k7 will offer it again at its next start.")
            return false
        }
        DispatchQueue.main.async { self.openBrowser(link) }
        let retry = settle(pairing, cookie: cookie)
        DispatchQueue.main.async {
            self.session?.cancel()
            self.session = nil
        }
        return retry
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

    /// Wait on the backend for the pairing's ending, say it, and let the backend drop it; true when the person asked to try again.
    private func settle(_ first: [String: Any], cookie: String) -> Bool {
        let state = first["state"] as? String ?? ""
        var p = first
        while p["phase"] as? String == "waiting" {
            guard let next = local("GET", "\(Self.pairApi)/\(state)?wait=\(Self.pollMs)", cookie: cookie)?["pairing"] as? [String: Any] else {
                Dialogs.tell("The sync pairing was interrupted. k7 will offer it again at its next start.")
                return false
            }
            p = next
        }
        _ = local("DELETE", "\(Self.pairApi)/\(state)", cookie: cookie)
        let host = p["host"] as? String ?? Self.syncHost
        log.info("sync pairing with \(host, privacy: .public): \(p["phase"] as? String ?? "", privacy: .public)")
        switch p["phase"] as? String {
        case "paired":
            // The same token lists this phone's engine at that studio, which may admit paired machines only.
            SupervisorHost.shared.rememberDeviceToken(origin: p["origin"] as? String ?? "", token: p["token"] as? String ?? "")
            Dialogs.tell("This phone now syncs its workspaces with \(host).")
        case "otherAccount":
            let browserAs = p["browserAs"] as? String ?? ""
            let who = browserAs.isEmpty ? "as another account" : "as \(browserAs)"
            let email = p["email"] as? String ?? ""
            return Dialogs.ask(
                "Sync",
                "Nothing was paired: the browser is signed in to \(host) \(who), and this phone is signed in as \(email).\n\nSign in to \(host) in the browser as \(email), then try again.",
                yes: "Try again", no: "Not now"
            )
        case "expired":
            Dialogs.tell("The sync pairing was not finished in the browser. k7 will offer it again at its next start.")
        default:
            Dialogs.tell("The sync pairing could not be saved on this phone. k7 will offer it again at its next start.")
        }
        return false
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
