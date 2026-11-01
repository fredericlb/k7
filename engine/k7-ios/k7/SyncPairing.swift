// SyncPairing.swift — sign the phone in to its ONE server: signing in IS the pairing. The phone's backend gives the
// server's sign-in URL (packages/file-hub/pairRoutes.ts, Android's and the tray's too), opened in an
// ASWebAuthenticationSession over the app; the server sends a one-use code back to this app's scheme, which the sheet
// hands here, and the backend trades it for the link. See engine/k7-runtime/docs/ios.md.

import AuthenticationServices
import Foundation
import os
import UIKit

final class SyncPairing: NSObject, ASWebAuthenticationPresentationContextProviding {
    /// web-protocol's STUDIO_ORIGIN: the server a phone signs in to when the page names none.
    private static let defaultOrigin = "https://app.k7.rocks"
    /// The app's scheme, where the server sends its code: `se.frediver.k7://pair`.
    private static let scheme = "se.frediver.k7"
    /// The phone's backend's sign-in routes, and the return that trades the server's code (packages/file-hub/pairRoutes.ts).
    private static let pairApi = "/api/sync/remote/pair"
    private static let returnPath = "/desktop/sync-pair"
    /// One long poll of the backend while the trade finishes, in ms.
    private static let pollMs = 25_000

    private static let shared = SyncPairing()
    private let log = Logger(subsystem: "se.frediver.k7", category: "k7-sync")
    private var session: ASWebAuthenticationSession?

    /// RFC 3986's unreserved characters, ASCII only: everything else in a query value is percent-encoded.
    static let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    /// The server the page named, when it is one: https, or http on this phone only.
    private static func normalize(_ input: String?) -> String? {
        guard let raw = input?.trimmingCharacters(in: .whitespaces), !raw.isEmpty,
              let u = URLComponents(string: raw), let host = u.host?.lowercased(), u.user == nil, u.password == nil else { return nil }
        let loopback = ["127.0.0.1", "localhost", "::1"].contains(host)
        guard u.scheme == "https" || (u.scheme == "http" && loopback) else { return nil }
        return u.port.map { "\(u.scheme!)://\(host):\($0)" } ?? "\(u.scheme!)://\(host)"
    }

    /// Sign in to `input` from the page's `/auth/login?server=`; `onPaired` runs on the main thread once linked.
    static func start(_ input: String?, cookie: String, onPaired: @escaping () -> Void) {
        let origin = normalize(input) ?? defaultOrigin
        let name = deviceName()
        Thread {
            let body: [String: Any] = ["origin": origin, "name": name, "scheme": scheme]
            guard let started = shared.local("POST", pairApi, cookie: cookie, body: body),
                  let link = (started["url"] as? String).flatMap(URL.init(string:)) else {
                Dialogs.tell("The sign-in could not start. Try again.")
                return
            }
            DispatchQueue.main.async { shared.open(link, cookie: cookie, onPaired: onPaired) }
        }.start()
    }

    private func open(_ url: URL, cookie: String, onPaired: @escaping () -> Void) {
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: Self.scheme) { [self] answer, _ in
            self.session = nil
            guard let answer, let parts = URLComponents(url: answer, resolvingAgainstBaseURL: false) else { return }
            let item = { (name: String) in parts.queryItems?.first { $0.name == name }?.value ?? "" }
            Thread { self.finish(code: item("code"), state: item("state"), cookie: cookie, onPaired: onPaired) }.start()
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        self.session = session
        if !session.start() { log.warning("the sign-in sheet did not open") }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        Dialogs.top()?.view.window ?? ASPresentationAnchor()
    }

    /// The backend trades the server's code at its return, then the ending is said; on this thread.
    private func finish(code: String, state: String, cookie: String, onPaired: @escaping () -> Void) {
        let q = { (v: String) in v.addingPercentEncoding(withAllowedCharacters: Self.unreserved) ?? "" }
        // The return answers a page, not JSON: only its having answered matters, the ending is read from the pairing.
        _ = local("GET", "\(Self.returnPath)?code=\(q(code))&state=\(q(state))", cookie: "", json: false)
        guard let first = local("GET", "\(Self.pairApi)/\(q(state))", cookie: cookie)?["pairing"] as? [String: Any] else {
            Dialogs.tell("The sign-in was interrupted. Sign in again from the settings.")
            return
        }
        var p = first
        while p["phase"] as? String == "waiting" {
            guard let next = local("GET", "\(Self.pairApi)/\(q(state))?wait=\(Self.pollMs)", cookie: cookie)?["pairing"] as? [String: Any] else {
                Dialogs.tell("The sign-in was interrupted. Sign in again from the settings.")
                return
            }
            p = next
        }
        _ = local("DELETE", "\(Self.pairApi)/\(q(state))", cookie: cookie)
        let host = p["host"] as? String ?? ""
        log.info("sign-in to \(host, privacy: .public): \(p["phase"] as? String ?? "", privacy: .public)")
        switch p["phase"] as? String {
        case "paired":
            // The same token lists this phone's engine at that server, which may admit paired machines only.
            SupervisorHost.shared.rememberDeviceToken(origin: p["origin"] as? String ?? "", token: p["token"] as? String ?? "")
            Dialogs.tell("Signed in to \(host) as \(p["browserAs"] as? String ?? "").")
            DispatchQueue.main.async(execute: onPaired)
        case "expired":
            Dialogs.tell("The sign-in was not finished in the browser. Sign in again from the settings.")
        default:
            Dialogs.tell("The sign-in could not be saved on this phone. Sign in again from the settings.")
        }
    }

    /// The phone's backend, as the view's session: its cookie, read from the views' cookie store.
    private func local(_ method: String, _ path: String, cookie: String, body: [String: Any]? = nil, json: Bool = true) -> [String: Any]? {
        var request = URLRequest(url: URL(string: BackendHost.origin + path)!)
        request.httpMethod = method
        // Longer than one long poll of a sign-in under way.
        request.timeoutInterval = 60
        if !cookie.isEmpty { request.setValue(cookie, forHTTPHeaderField: "Cookie") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        let done = DispatchSemaphore(value: 0)
        var out: [String: Any]?
        URLSession.shared.dataTask(with: request) { data, response, _ in
            if json, let code = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(code), let data {
                out = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            }
            done.signal()
        }.resume()
        done.wait()
        return out
    }

    /// What the server's device list shows: the phone's model as iOS names it to an app.
    private static func deviceName() -> String {
        Thread.isMainThread ? UIDevice.current.model : DispatchQueue.main.sync { UIDevice.current.model }
    }
}
