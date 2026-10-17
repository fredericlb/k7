// StudioBridge.swift — what the studio apps in AppViews' views may ask of this app, over one script message handler
// that `window.k7Ios` wraps in the protocol Android's `k7Android` speaks: every app reports its top colour, who
// is signed in, what it plays and what keeps it busy; ONLY k7, checked by origin on every message, reaches the
// engine (apps/k7/frontend/src/settings/androidEngine.ts). The handler is offered to every origin, since the studio
// can change; each message is checked instead. k7's origin may be a remote studio, so it gets a short list of
// commands, and a new studio needs the user's yes. See engine/k7-runtime/docs/ios.md.

import UIKit
import UniformTypeIdentifiers
import WebKit

final class StudioBridge: NSObject, WKScriptMessageHandler, SupervisorListener, UIDocumentPickerDelegate {
    static let name = "k7Ios"

    /// Which app an origin is, or nil for anywhere else.
    private let appOf: (URL) -> String?
    private let onColor: (String, UIColor) -> Void
    /// Who the studio says is signed in, nil for nobody (account.js).
    private let onAccount: (String?) -> Void
    private let onChooseStudio: (String) -> Void
    // The k7 page listening now: a reload hands over a new one with its `listen`.
    private weak var k7: WKWebView?
    private var studio: String?
    private var pickedCa: ((URL?) -> Void)?

    /// The document-start script that gives a page the channel, in the shape Android's WebMessageListener object has.
    static let channelScript = """
    (() => {
      if (window.k7Ios || !window.webkit || !window.webkit.messageHandlers.k7Ios) return;
      const listeners = new Set();
      const channel = {
        onmessage: null,
        postMessage: (data) => window.webkit.messageHandlers.k7Ios.postMessage(String(data)),
        addEventListener: (type, listener) => { if (type === "message") listeners.add(listener); },
        removeEventListener: (type, listener) => { if (type === "message") listeners.delete(listener); },
      };
      Object.defineProperty(window, "k7Ios", { value: channel });
      Object.defineProperty(window, "__k7IosDeliver", {
        value: (data) => {
          const e = { data };
          for (const l of listeners) l(e);
          if (channel.onmessage) channel.onmessage(e);
        },
      });
    })();
    """

    init(appOf: @escaping (URL) -> String?, onColor: @escaping (String, UIColor) -> Void,
         onAccount: @escaping (String?) -> Void, onChooseStudio: @escaping (String) -> Void) {
        self.appOf = appOf
        self.onColor = onColor
        self.onAccount = onAccount
        self.onChooseStudio = onChooseStudio
        super.init()
        SupervisorHost.shared.listen(self)
    }

    func destroy() {
        SupervisorHost.shared.unlisten(self)
    }

    /// The studio the views open now, k7's origin; the panel marks it.
    func setStudio(_ origin: String?) {
        if origin == studio { return }
        studio = origin
        push()
    }

    /// One message to a page, as the channel's `message` event; on the main thread.
    static func post(_ msg: [String: Any], to view: WKWebView) {
        guard let data = try? JSONSerialization.data(withJSONObject: msg),
              let literal = try? JSONSerialization.data(withJSONObject: [String(decoding: data, as: UTF8.self)]),
              let array = String(data: literal, encoding: .utf8) else { return }
        // A one-element JSON array is a JS literal of that string: no quoting by hand.
        let js = "window.__k7IosDeliver && window.__k7IosDeliver(\(array)[0])"
        if Thread.isMainThread { view.evaluateJavaScript(js) } else { DispatchQueue.main.async { view.evaluateJavaScript(js) } }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let view = message.webView, let id = (view as? AppWebView)?.appId else { return }
        // The view's own app and nothing else: a page it wandered off to gets no answer.
        let origin = message.frameInfo.securityOrigin
        var parts = URLComponents()
        parts.scheme = origin.protocol
        parts.host = origin.host
        if origin.port != 0 { parts.port = origin.port }
        guard message.frameInfo.isMainFrame, let url = parts.url, appOf(url) == id,
              let text = message.body as? String, let data = text.data(using: .utf8),
              let msg = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        switch msg["t"] as? String {
        case "color":
            if let hex = msg["value"] as? String, let color = UIColor(hex: hex) { onColor(id, color) }
        case "account":
            onAccount(msg["name"] as? String)
        case "media":
            MediaPlayback.update(msg, from: view)
        case "busy":
            Busy.shared.report(view: id, msg)
        case "listen":
            if id == "k7" {
                k7 = view
                push()
            }
        case "call":
            if id == "k7" { call(view, id: msg["id"] as? Int ?? 0, method: msg["method"] as? String ?? "", arg: msg["arg"] as? [String: Any] ?? [:]) }
        default:
            break
        }
    }

    func onState(_ frame: [String: Any]) { push() }

    func onEngineExit(_ code: Int) { push() }

    private func push() {
        let known = SupervisorHost.shared.known()
        DispatchQueue.main.async { [self] in
            guard let k7 else { return }
            var snapshot: [String: Any] = ["t": "snapshot", "studio": studio ?? NSNull()]
            if let state = known.state { snapshot["state"] = state }
            if let exit = known.engineExit { snapshot["engineExit"] = exit }
            Self.post(snapshot, to: k7)
        }
    }

    private func call(_ view: WKWebView, id: Int, method: String, arg: [String: Any]) {
        let answer = { (done: Result<[String: Any], Error>) in
            var out: [String: Any] = ["t": "reply", "id": id]
            switch done {
            case .success(let value):
                out["ok"] = true
                out["value"] = value
            case .failure(let error):
                out["ok"] = false
                out["error"] = error.localizedDescription
            }
            Self.post(out, to: view)
        }
        switch method {
        case "command":
            command(arg["cmd"] as? String ?? "", arg["arg"] as? String ?? "", answer)
        case "lanAddress":
            answer(.success(EngineOps.lanAddress().map { ["address": $0] } ?? [:]))
        case "casInfo":
            answer(.success(["count": TrustedCas.count()]))
        case "importCa":
            pickCa { url in
                guard let url else { return answer(.success(["said": "", "count": TrustedCas.count()])) }
                EngineOps.importCa(url, done: answer)
            }
        case "forgetCas":
            EngineOps.forgetCas(done: answer)
        case "chooseStudio":
            chooseStudio(arg["origin"] as? String ?? "", answer)
        case "quit":
            answer(.success([:]))
            AppDelegate.quit()
        default:
            answer(.failure(Self.refusal("no method \(method)")))
        }
    }

    private func command(_ cmd: String, _ arg: String, _ answer: @escaping (Result<[String: Any], Error>) -> Void) {
        let send = {
            SupervisorHost.shared.command(cmd, arg)
            answer(.success([:]))
        }
        if Self.allowed.contains(cmd) { return send() }
        // A new studio is where this engine registers and k7 may then open: never added on a page's word alone.
        guard cmd == "weburi.add" else { return answer(.failure(Self.refusal("command \(cmd) is not allowed"))) }
        guard Self.isStudioUrl(arg) else { return answer(.failure(Self.refusal("not a studio address"))) }
        Dialogs.confirm("k7", "Connect this phone's engine to the studio at\n\n\(arg) ?", yes: "Connect") { yes in
            yes ? send() : answer(.failure(Self.refusal("declined")))
        }
    }

    private func chooseStudio(_ origin: String, _ answer: @escaping (Result<[String: Any], Error>) -> Void) {
        guard Self.isStudioUrl(origin), let url = URL(string: origin), let host = url.host,
              url.scheme == "https" || Self.isLoopback(host) else {
            return answer(.failure(Self.refusal("a studio must be https")))
        }
        let open = {
            self.onChooseStudio(origin)
            answer(.success([:]))
        }
        if Self.isLoopback(host) || listed(url) { return open() }
        Dialogs.confirm("k7", "Open k7 on the studio at\n\n\(origin) ?", yes: "Open") { yes in
            yes ? open() : answer(.failure(Self.refusal("declined")))
        }
    }

    /// Whether `origin` is one of the studios the supervisor lists: the host itself, or the family above a `play.`/`k7.` alias.
    private func listed(_ origin: URL) -> Bool {
        let instances = SupervisorHost.shared.known().state?["instances"] as? [[String: Any]] ?? []
        guard let host = origin.host?.lowercased() else { return false }
        return instances.contains { row in
            guard let url = URL(string: row["url"] as? String ?? ""), let h = url.host?.lowercased() else { return false }
            return url.scheme == origin.scheme && (h == host || h.hasSuffix(".\(host)"))
        }
    }

    // The document picker, for a certificate file; nil when the user cancelled.
    private func pickCa(_ then: @escaping (URL?) -> Void) {
        DispatchQueue.main.async { [self] in
            pickedCa = then
            let types = [UTType.x509Certificate, UTType(filenameExtension: "pem"), UTType(filenameExtension: "crt"), UTType.data]
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types.compactMap { $0 })
            picker.delegate = self
            Dialogs.top()?.present(picker, animated: true)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        pickedCa?(urls.first)
        pickedCa = nil
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickedCa?(nil)
        pickedCa = nil
    }

    private static func refusal(_ why: String) -> Error {
        NSError(domain: "k7", code: 4, userInfo: [NSLocalizedDescriptionKey: why])
    }

    /// The desktop's list (apps/k7-standalone/src/engineBridge.ts), plus removing a studio, which only unlists this engine.
    private static let allowed: Set<String> = [
        "engine.start", "engine.stop", "engine.restart", "audio.priority",
        "plugins.rescan", "instruments.download", "instruments.remove", "weburi.remove",
    ]

    // An address the dialog can show as it is: http(s), a host, short, and no whitespace to forge lines with.
    private static func isStudioUrl(_ url: String) -> Bool {
        guard url.count <= 200, !url.contains(where: \.isWhitespace), let u = URL(string: url),
              let scheme = u.scheme, ["http", "https"].contains(scheme), let host = u.host, !host.isEmpty else { return false }
        return true
    }

    private static func isLoopback(_ host: String) -> Bool {
        let h = host.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        return ["localhost", "127.0.0.1", "::1"].contains(h)
    }
}

extension UIColor {
    /// `#rrggbb`, which is what top-color.js reports.
    convenience init?(hex: String) {
        guard hex.hasPrefix("#"), hex.count == 7, let v = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        self.init(red: CGFloat(v >> 16 & 0xFF) / 255, green: CGFloat(v >> 8 & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }
}
