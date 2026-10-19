// AppViews.swift — the studio apps, each in a full-screen WKWebView of its own over the shell page (web/src/App.tsx,
// AppViews), under a status-bar strip painted the colour of the app's own header. They load from the connected
// studio, never from this app: each app is same-origin with its backend (`/api`, `/auth`, cookie sessions). A view
// is made the first time it is shown and then only hidden, so an app keeps its state while another is on screen.
// The same plugin, methods and events as AppViewsPlugin.kt on Android. See engine/k7-runtime/docs/ios.md.

import Capacitor
import UIKit
import WebKit

/// A view that knows which app it shows, for the bridge's origin check.
final class AppWebView: WKWebView {
    var appId = ""
}

@objc(AppViewsPlugin)
public class AppViewsPlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate, WKUIDelegate {
    public let identifier = "AppViewsPlugin"
    public let jsName = "AppViews"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hideAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "backend", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restartBackend", returnType: CAPPluginReturnPromise),
    ]

    private let frame = UIView()
    // Under the status bar, in the visible app's top colour.
    private let strip = UIView()
    private var studio: String?
    private var appBridge: StudioBridge!
    private var colors: [String: UIColor] = [:]
    private var views: [String: AppWebView] = [:]
    // The address each view was last pointed at by `apps`: a changed studio reloads it, a tab switch does not.
    private var loaded: [String: String] = [:]
    private var apps: [String: URL] = [:]
    private var visible: String?
    private var localSignInAt = Date.distantPast
    private var backendWatch: UUID?
    private var scripts: [WKUserScript] = []

    override public func load() {
        guard let host = bridge?.viewController?.view else { return }
        frame.isHidden = true
        frame.backgroundColor = UIColor(red: 0.04, green: 0.04, blue: 0.05, alpha: 1)
        frame.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(frame)
        strip.translatesAutoresizingMaskIntoConstraints = false
        frame.addSubview(strip)
        NSLayoutConstraint.activate([
            frame.topAnchor.constraint(equalTo: host.topAnchor),
            frame.bottomAnchor.constraint(equalTo: host.bottomAnchor),
            frame.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            frame.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            strip.topAnchor.constraint(equalTo: frame.topAnchor),
            strip.leadingAnchor.constraint(equalTo: frame.leadingAnchor),
            strip.trailingAnchor.constraint(equalTo: frame.trailingAnchor),
            strip.bottomAnchor.constraint(equalTo: frame.safeAreaLayoutGuide.topAnchor),
        ])
        scripts = Self.pageScripts()
        appBridge = StudioBridge(
            appOf: { [weak self] in self?.appOf($0) },
            onColor: { [weak self] id, color in
                self?.colors[id] = color
                if id == self?.visible { self?.paint() }
            },
            onAccount: { [weak self] name in DispatchQueue.main.async { self?.onAccount(name) } },
            onChooseStudio: { [weak self] origin in self?.notifyListeners("studio", data: ["origin": origin]) }
        )
        backendWatch = BackendHost.shared.watch { [weak self] status in
            DispatchQueue.main.async { self?.notifyListeners("backend", data: Self.statusJs(status)) }
        }
    }

    deinit {
        if let backendWatch { BackendHost.shared.unwatch(backendWatch) }
        appBridge?.destroy()
    }

    /// The scripts every view runs: the channel, the loopback ports, the media session at document start; colour and account once loaded.
    private static func pageScripts() -> [WKUserScript] {
        func asset(_ name: String) -> String {
            guard let url = Bundle.main.url(forResource: name, withExtension: "js", subdirectory: "page-scripts"),
                  let text = try? String(contentsOf: url, encoding: .utf8) else { return "" }
            return text
        }
        // web-protocol's PORTS_GLOBAL, for the phone's own studio only, whose pages derive each service's address from it.
        let ports = "if (location.origin === \(Self.jsString(BackendHost.origin))) window.__STUDIO_PORTS__ = \(Self.jsString(BackendHost.portsSpec));"
        return [
            WKUserScript(source: StudioBridge.channelScript, injectionTime: .atDocumentStart, forMainFrameOnly: true),
            WKUserScript(source: ports, injectionTime: .atDocumentStart, forMainFrameOnly: true),
            WKUserScript(source: asset("media-session"), injectionTime: .atDocumentStart, forMainFrameOnly: true),
            WKUserScript(source: asset("top-color"), injectionTime: .atDocumentEnd, forMainFrameOnly: true),
            WKUserScript(source: asset("account"), injectionTime: .atDocumentEnd, forMainFrameOnly: true),
        ]
    }

    private static func jsString(_ s: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [s])
        return data.flatMap { String(data: $0, encoding: .utf8) }.map { String($0.dropFirst().dropLast()) } ?? "\"\""
    }

    @objc func show(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { return call.reject("no id") }
        guard let given = call.getObject("apps") else { return call.reject("no apps") }
        let url = call.getString("url")
        let studio = call.getString("studio")
        // The phone's own studio may still be starting: wait rather than fail.
        if studio == BackendHost.origin {
            BackendHost.shared.whenReady({ [weak self] in
                DispatchQueue.main.async { self?.show(call, id: id, given: given, url: url, studio: studio) }
            }, failed: { [weak self] why in
                DispatchQueue.main.async {
                    self?.loadFailed(id, "k7 could not start: \(why)")
                    call.resolve()
                }
            })
        } else {
            DispatchQueue.main.async { self.show(call, id: id, given: given, url: url, studio: studio) }
        }
    }

    /// Where the phone's own backend is: `starting` (with `step`), `ready` or `failed` (with `message`); then `backend` events.
    @objc func backend(_ call: CAPPluginCall) {
        call.resolve(Self.statusJs(BackendHost.shared.current()))
    }

    private static func statusJs(_ s: BackendHost.Status) -> [String: Any] {
        var out: [String: Any] = ["state": s.state]
        if let step = s.step { out["step"] = step }
        if let message = s.message { out["message"] = message }
        return out
    }

    /// The shell page's Retry: BackendHost's user retry; the `backend` events say how it goes.
    @objc func restartBackend(_ call: CAPPluginCall) {
        BackendHost.shared.retry()
        call.resolve()
    }

    private func show(_ call: CAPPluginCall, id: String, given: JSObject, url: String?, studio: String?) {
        apps = given.compactMapValues { ($0 as? String).flatMap(URL.init(string:)) }
        guard let address = apps[id]?.absoluteString else { return call.reject("no address for \(id)") }
        // On the phone's own studio a view opens as the local user, as the desktop window does.
        let home = studio == BackendHost.origin && id == "k7" ? BackendHost.localHome : address
        appBridge.setStudio(studio)
        self.studio = studio
        let view = views[id] ?? create(id)
        if let url, let to = URL(string: url) {
            view.load(URLRequest(url: to))
        } else if loaded[id] != home, let to = URL(string: home) {
            view.load(URLRequest(url: to))
        }
        loaded[id] = home
        for (key, v) in views { v.isHidden = key != id }
        visible = id
        frame.isHidden = false
        frame.superview?.bringSubviewToFront(frame)
        paint()
        call.resolve()
    }

    @objc func hideAll(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            frame.isHidden = true
            visible = nil
            MainViewController.current?.statusBarDark = false
            call.resolve()
        }
    }

    @objc func reload(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { return call.reject("no id") }
        DispatchQueue.main.async { [self] in
            views[id]?.reload()
            call.resolve()
        }
    }

    /// In the system browser, never in a view: identity providers refuse WebViews (RFC 8252 §8.12).
    private func signIn() {
        guard let at = studio else { return }
        AuthHandoff.start(studio: at, returnTo: { [weak self] in
            guard let u = self?.views["k7"]?.url, let parts = URLComponents(url: u, resolvingAgainstBaseURL: false) else { return "/" }
            return parts.path + (parts.query.map { "?\($0)" } ?? "")
        }, redeemed: { [weak self] to in
            // Straight into the view: a `navigate` to the app already shown changes nothing on the page.
            self?.views["k7"]?.load(URLRequest(url: to))
        })
    }

    /// Who the studio says is signed in; on the phone's own studio nobody means back to the local user, and an account pairs.
    private func onAccount(_ name: String?) {
        if name != nil && studio == BackendHost.origin {
            WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
                let header = cookies.filter { $0.domain == "127.0.0.1" }.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
                SyncPairing.pairIfNeeded(cookie: header)
            }
        }
        guard name == nil, studio == BackendHost.origin else { return }
        // Once in a while at most: a local sign-in that keeps failing must not reload forever.
        if Date().timeIntervalSince(localSignInAt) < Self.localSignInGap { return }
        localSignInAt = Date()
        if let to = URL(string: BackendHost.localHome) { views["k7"]?.load(URLRequest(url: to)) }
    }

    // Until the page has said, the shell page's own background shows through.
    private func paint() {
        let color = visible.flatMap { colors[$0] } ?? .clear
        strip.backgroundColor = color
        var white: CGFloat = 0
        if color != .clear, color.getWhite(&white, alpha: nil) {
            MainViewController.current?.statusBarDark = white > 0.5
        }
    }

    private func create(_ id: String) -> AppWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // How an app can tell it is inside this one, should it ever need to.
        config.applicationNameForUserAgent = "k7-ios"
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        let content = config.userContentController
        content.add(appBridge, name: StudioBridge.name)
        scripts.forEach(content.addUserScript)
        let view = AppWebView(frame: .zero, configuration: config)
        view.appId = id
        view.navigationDelegate = self
        view.uiDelegate = self
        // The edge swipe is iOS's Back: the view's own history first.
        view.allowsBackForwardNavigationGestures = true
        view.isOpaque = false
        view.backgroundColor = .clear
        view.isInspectable = Self.inspectable
        view.translatesAutoresizingMaskIntoConstraints = false
        frame.addSubview(view)
        NSLayoutConstraint.activate([
            view.topAnchor.constraint(equalTo: frame.safeAreaLayoutGuide.topAnchor),
            view.bottomAnchor.constraint(equalTo: frame.safeAreaLayoutGuide.bottomAnchor),
            view.leadingAnchor.constraint(equalTo: frame.safeAreaLayoutGuide.leadingAnchor),
            view.trailingAnchor.constraint(equalTo: frame.safeAreaLayoutGuide.trailingAnchor),
        ])
        views[id] = view
        return view
    }

    #if DEBUG
    private static let inspectable = true
    #else
    private static let inspectable = false
    #endif

    /// Which app `url` is one of, by origin; nil for anywhere else.
    private func appOf(_ url: URL) -> String? {
        apps.first { _, home in home.scheme == url.scheme && home.host == url.host && home.port == url.port }?.key
    }

    /// Somewhere this app does not show: Safari, Mail, the phone — and only those, by scheme.
    private func openOutside(_ url: URL) {
        // A page may name any scheme: one handed to another app could launch what it should not.
        guard let scheme = url.scheme?.lowercased(), Self.outsideSchemes.contains(scheme) else { return }
        UIApplication.shared.open(url)
    }

    /// A link the user followed into another tab's app: the page switches tab, and that view loads it.
    private func navigate(_ id: String, _ url: URL) {
        notifyListeners("navigate", data: ["id": id, "url": url.absoluteString])
    }

    /// The studio did not answer: the shell page takes over, with the tray and a retry, since no app is there to reach settings in.
    private func loadFailed(_ id: String, _ why: String) {
        notifyListeners("loadError", data: ["id": id, "message": why])
    }

    private func route(_ url: URL) {
        if let to = appOf(url) { navigate(to, url) } else { openOutside(url) }
    }

    // MARK: WKNavigationDelegate

    public func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, let id = (webView as? AppWebView)?.appId else { return decisionHandler(.allow) }
        if action.shouldPerformDownload { return decisionHandler(.download) }
        let scheme = url.scheme?.lowercased()
        if scheme != "http" && scheme != "https" {
            // about:blank and the page's own blob: and data: frames are the page's business.
            if ["about", "blob", "data"].contains(scheme ?? "") { return decisionHandler(.allow) }
            openOutside(url)
            return decisionHandler(.cancel)
        }
        // The studio's sign-in, however it was reached — a click, a script, a redirect: it goes to the browser.
        if appOf(url) != nil && url.path == "/auth/login" {
            // The server the page's popin named is where the account will sync once signed in.
            SyncPairing.choose(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "server" }?.value)
            signIn()
            return decisionHandler(.cancel)
        }
        // Only a link the user followed moves tabs; a redirect or a script's navigation stays put.
        guard action.navigationType == .linkActivated, action.targetFrame?.isMainFrame != false,
              let to = appOf(url), to != id else { return decisionHandler(.allow) }
        navigate(to, url)
        decisionHandler(.cancel)
    }

    public func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    public func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = Downloads.shared
    }

    public func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = Downloads.shared
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        failed(webView, error)
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        failed(webView, error)
    }

    // A navigation this file cancelled, or one turned into a download, is no failure of the studio's.
    private func failed(_ webView: WKWebView, _ error: Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return }
        if let id = (webView as? AppWebView)?.appId { loadFailed(id, e.localizedDescription) }
    }

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // A studio behind the user's own CA: the views know only iOS's roots, so the CAs the tray was given are asked too.
    public func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
                        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust else { return completionHandler(.performDefaultHandling, nil) }
        if SecTrustEvaluateWithError(trust, nil) { return completionHandler(.performDefaultHandling, nil) }
        let host = challenge.protectionSpace.host
        if TrustedCas.vouch(trust, host: host) { return completionHandler(.useCredential, URLCredential(trust: trust)) }
        completionHandler(.cancelAuthenticationChallenge, nil)
        // The studio's own certificate, not some embed's: nothing of the app can load.
        if let id = (webView as? AppWebView)?.appId, apps[id]?.host == host {
            loadFailed(id, "the studio's certificate is not trusted")
        }
    }

    // MARK: WKUIDelegate

    // A new window is never opened: where it was headed is routed instead.
    public func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                        for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, url.absoluteString != "about:blank" { route(url) }
        return nil
    }

    // The microphone, to the studio's own apps only, once iOS grants it, asked here on first need (MicAccess.swift).
    public func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                        initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                        decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        var parts = URLComponents()
        parts.scheme = origin.protocol
        parts.host = origin.host
        if origin.port != 0 { parts.port = origin.port }
        guard type == .microphone, let url = parts.url, appOf(url) != nil else { return decisionHandler(.deny) }
        MicAccess.request { [weak self] answer in
            decisionHandler(answer == .granted ? .grant : .deny)
            // Blocked for good: the page hears why its getUserMedia failed, beside the native dialog.
            if answer == .blocked {
                self?.views.values.forEach { $0.evaluateJavaScript("dispatchEvent(new CustomEvent('k7:mic-denied'))") }
            }
        }
    }

    public func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        guard let top = Dialogs.top() else { return completionHandler() }
        top.present(alert, animated: true)
    }

    public func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        guard let top = Dialogs.top() else { return completionHandler(false) }
        top.present(alert, animated: true)
    }

    public func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        guard let top = Dialogs.top() else { return completionHandler(nil) }
        top.present(alert, animated: true)
    }

    private static let localSignInGap: TimeInterval = 5
    // What openOutside hands to another app; anything else is dropped.
    private static let outsideSchemes: Set<String> = ["http", "https", "mailto", "tel"]
}
