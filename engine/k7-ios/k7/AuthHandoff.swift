// AuthHandoff.swift — sign in to the studio in the SYSTEM browser and carry the session back into the app's views.
// Identity providers refuse a WebView, and RFC 8252 says why they should. ASWebAuthenticationSession is the
// browser here: Safari's cookies and passwords, over the app, so the app stays in front and the verifier stays in
// memory. Mirrors packages/web-protocol/handoff.ts; see engine/k7-runtime/docs/ios.md.

import AuthenticationServices
import CryptoKit
import UIKit

final class AuthHandoff: NSObject, ASWebAuthenticationPresentationContextProviding {
    /// The app's own scheme; the server sends the code nowhere else but loopback.
    static let scheme = "se.frediver.k7"
    private static let host = "auth"
    private static let issue = "/auth/handoff/issue"
    private static let redeem = "/auth/handoff/redeem"
    private static let shared = AuthHandoff()
    private var session: ASWebAuthenticationSession?

    private static func b64(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func random() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return b64(Data(bytes))
    }

    /// Open the browser on `studio`'s sign-in; `redeemed` gets the address that turns its answer into a session in a view.
    static func start(studio: String, returnTo: @escaping () -> String, redeemed: @escaping (URL) -> Void) {
        let verifier = random()
        let state = random()
        let challenge = b64(Data(SHA256.hash(data: Data(verifier.utf8))))
        guard var url = URLComponents(string: studio) else { return }
        url.path = issue
        url.queryItems = [
            URLQueryItem(name: "redirect", value: "\(scheme)://\(host)"),
            URLQueryItem(name: "challenge", value: challenge),
            URLQueryItem(name: "state", value: state),
        ]
        guard let issueUrl = url.url else { return }
        let session = ASWebAuthenticationSession(url: issueUrl, callbackURLScheme: scheme) { answer, _ in
            shared.session = nil
            guard let answer, let parts = URLComponents(url: answer, resolvingAgainstBaseURL: false),
                  parts.host == host,
                  parts.queryItems?.first(where: { $0.name == "state" })?.value == state,
                  let code = parts.queryItems?.first(where: { $0.name == "code" })?.value,
                  var back = URLComponents(string: studio) else { return }
            back.path = redeem
            back.queryItems = [
                URLQueryItem(name: "code", value: code),
                URLQueryItem(name: "verifier", value: verifier),
                URLQueryItem(name: "return_to", value: returnTo()),
            ]
            if let to = back.url { DispatchQueue.main.async { redeemed(to) } }
        }
        session.presentationContextProvider = shared
        // Not ephemeral: the browser's own session at the identity provider is what spares a second password.
        session.prefersEphemeralWebBrowserSession = false
        shared.session = session
        if !session.start() {
            shared.session = nil
            Dialogs.inform("k7", "The browser could not be opened to sign in.")
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        Dialogs.top()?.view.window ?? ASPresentationAnchor()
    }
}
