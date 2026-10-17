// EnginePlugin.swift — the shell page's way to the supervisor (web/src/native.ts, K7Runtime): its snapshots as
// `state` events, the engine's exit as `engineExit`, and the few commands the tray sends — EnginePlugin.kt's
// methods, one for one. k7's settings panel reaches the same through StudioBridge.swift; what both do beyond a
// command is EngineOps.swift. See engine/k7-runtime/docs/ios.md.

import Capacitor
import UIKit
import UniformTypeIdentifiers

@objc(EnginePlugin)
public class EnginePlugin: CAPPlugin, CAPBridgedPlugin, SupervisorListener, UIDocumentPickerDelegate {
    public let identifier = "EnginePlugin"
    public let jsName = "K7Runtime"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "command", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lanAddress", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "casInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "importCa", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forgetCas", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "quit", returnType: CAPPluginReturnPromise),
    ]

    private var pending: CAPPluginCall?

    override public func load() {
        SupervisorHost.shared.listen(self)
    }

    deinit {
        SupervisorHost.shared.unlisten(self)
    }

    // Not retained: a page that was not listening yet asks getState, and a backlog of stale frames would only replay.
    func onState(_ frame: [String: Any]) {
        notifyListeners("state", data: frame)
    }

    func onEngineExit(_ code: Int) {
        notifyListeners("engineExit", data: ["code": code], retainUntilConsumed: true)
    }

    @objc func getState(_ call: CAPPluginCall) {
        let known = SupervisorHost.shared.known()
        var out: [String: Any] = [:]
        if let state = known.state { out["state"] = state }
        if let exit = known.engineExit { out["engineExit"] = exit }
        call.resolve(out)
    }

    @objc func command(_ call: CAPPluginCall) {
        guard let cmd = call.getString("cmd") else { return call.reject("no cmd") }
        SupervisorHost.shared.command(cmd, call.getString("arg") ?? "")
        call.resolve()
    }

    @objc func lanAddress(_ call: CAPPluginCall) {
        call.resolve(EngineOps.lanAddress().map { ["address": $0] } ?? [:])
    }

    @objc func casInfo(_ call: CAPPluginCall) {
        call.resolve(["count": TrustedCas.count()])
    }

    @objc func importCa(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            pending = call
            let types = [UTType.x509Certificate, UTType(filenameExtension: "pem"), UTType(filenameExtension: "crt"), UTType.data]
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types.compactMap { $0 })
            picker.delegate = self
            bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pending, let url = urls.first else { return }
        pending = nil
        EngineOps.importCa(url) { Self.settle(call, $0) }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pending?.resolve(["said": "", "count": TrustedCas.count()])
        pending = nil
    }

    @objc func forgetCas(_ call: CAPPluginCall) {
        EngineOps.forgetCas { Self.settle(call, $0) }
    }

    @objc func quit(_ call: CAPPluginCall) {
        call.resolve()
        AppDelegate.quit()
    }

    private static func settle(_ call: CAPPluginCall, _ done: Result<[String: Any], Error>) {
        switch done {
        case .success(let value): call.resolve(value)
        case .failure(let error): call.reject(error.localizedDescription)
        }
    }
}
