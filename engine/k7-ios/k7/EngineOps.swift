// EngineOps.swift — what the tray does beyond a supervisor command, for its two callers: the shell page's tray
// (EnginePlugin.swift), shown while no studio is connected, and k7's settings panel (StudioBridge.swift).
// A CA change restarts the supervisor, which adopts the running engine. See engine/k7-runtime/docs/ios.md.

import Foundation

enum EngineOps {
    /// Wi-Fi's IPv4, else any other up interface's: what a browser on the same LAN dials.
    static func lanAddress() -> String? {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let first = head else { return nil }
        defer { freeifaddrs(head) }
        var found: [String: String] = [:]
        for ifa in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let flags = Int32(ifa.pointee.ifa_flags)
            guard let addr = ifa.pointee.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET),
                  flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0 else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(addr, socklen_t(addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 else { continue }
            found[String(cString: ifa.pointee.ifa_name)] = String(cString: host)
        }
        return found["en0"] ?? found.values.first
    }

    /// Trust the certificate(s) at `url`; `done` gets `{said, count}`, or the reason it is not a certificate.
    static func importCa(_ url: URL, done: @escaping (Result<[String: Any], Error>) -> Void) {
        do {
            let added = try TrustedCas.importFile(url)
            restart(added.isEmpty ? "already trusted" : "now trusting \(added.joined(separator: "; "))", done: done)
        } catch {
            done(.failure(NSError(domain: "k7", code: 3, userInfo: [
                NSLocalizedDescriptionKey: "not a certificate: \(error.localizedDescription)",
            ])))
        }
    }

    static func forgetCas(done: @escaping (Result<[String: Any], Error>) -> Void) {
        TrustedCas.forget()
        restart("trusting the built-in CAs only", done: done)
    }

    // The supervisor reads its roots once, at start: a new one takes the change and adopts the running engine.
    private static func restart(_ said: String, done: @escaping (Result<[String: Any], Error>) -> Void) {
        Thread {
            SupervisorHost.shared.restart(timeout: AppDelegate.supervisorStop)
            done(.success(["said": said, "count": TrustedCas.count()]))
        }.start()
    }
}
