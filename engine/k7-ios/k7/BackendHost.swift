// BackendHost.swift — k7's own backend on the phone, so the app is standalone like the desktop one: the bundle the
// packaged desktop app runs too (apps/k7/backend/scripts/bundle.mjs), under NodeMobile, node as a framework, with
// the file services it starts on threads of their own. Node runs once per process and never again, so the
// backend is a WORKER of backend-boot.mjs, which this file starts, watches and relaunches. Port, environment and
// folders are the desktop's, from apps/k7/backend/standalone.json. See engine/k7-runtime/docs/ios.md.

import Foundation
import NodeMobile
import os

/// One per PROCESS, like the supervisor.
final class BackendHost {
    static let shared = BackendHost()

    /// standalone.json's table, read from the bundle: its port is the desktop app's, which its OIDC client's redirect is registered on.
    private static let table: [String: Any] = {
        let url = Bundle.main.resourceURL!.appendingPathComponent("backend/standalone.json")
        guard let data = try? Data(contentsOf: url),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [:] }
        return json
    }()
    static let port = table["port"] as? Int ?? 18789
    static var origin: String { "http://127.0.0.1:\(port)" }
    /// What every part that derives a loopback address is told — the backend, its file services, the supervisor, the pages.
    static var portsSpec: String { "k7=\(port)" }
    /// Where a signed-out view lands: the local user, unless a session is already there.
    static var localHome: String { "\(origin)/auth/local?return_to=%2F" }

    /// What the shell page shows: `starting` with a step (`launching`), `ready`, or `failed` with why.
    struct Status {
        let state: String
        var step: String?
        var message: String?
    }

    private let log = Logger(subsystem: "se.frediver.k7", category: "k7-backend")
    private let lock = NSLock()
    private var nodeStarted = false
    private var control: FileHandle?
    private var running = false
    private var started = false
    private var stopping = false
    private var ready = false
    private var since = Date()
    // Why the backend is given up on, until a view asks again; nil while it runs or is being relaunched.
    private var failure: String?
    private var quickExits = 0
    private var waiting: [(then: () -> Void, failed: (String) -> Void)] = []
    private var status = Status(state: "starting")
    private var watchers: [UUID: (Status) -> Void] = [:]
    private var exitSignal: DispatchSemaphore?

    private init() {}

    func current() -> Status {
        lock.lock()
        defer { lock.unlock() }
        return status
    }

    /// Every status change from now on, called on whichever thread made it; the token unwatches.
    func watch(_ watcher: @escaping (Status) -> Void) -> UUID {
        let token = UUID()
        lock.lock()
        watchers[token] = watcher
        lock.unlock()
        return token
    }

    func unwatch(_ token: UUID) {
        lock.lock()
        watchers[token] = nil
        lock.unlock()
    }

    private func report(_ next: Status) {
        lock.lock()
        status = next
        let to = Array(watchers.values)
        lock.unlock()
        to.forEach { $0(next) }
    }

    /// Start node and the backend in it, once per process.
    func start() {
        lock.lock()
        if started {
            lock.unlock()
            return
        }
        started = true
        lock.unlock()
        attempt()
    }

    /// `then` once the backend has answered — at once if it has — or `failed` once it is given up on; either on any thread.
    func whenReady(_ then: @escaping () -> Void, failed: @escaping (String) -> Void) {
        lock.lock()
        let now = ready
        if !now { waiting.append((then, failed)) }
        lock.unlock()
        // A view asking after the backend was given up on is the user's retry.
        if now { then() } else { retry() }
    }

    /// The user's retry — a view asking again, or the shell page's Retry: a backend given up on starts over, with a fresh count.
    func retry() {
        lock.lock()
        let again = failure != nil && started
        if again {
            failure = nil
            quickExits = 0
        }
        lock.unlock()
        if again { attempt() }
    }

    /// Its stdin closed, which the backend answers by stopping its file services; ended after `timeout` seconds.
    func stop(timeout: TimeInterval) {
        lock.lock()
        stopping = true
        let live = running
        let signal = DispatchSemaphore(value: 0)
        if live { exitSignal = signal }
        lock.unlock()
        guard live else { return }
        send(["t": "stop", "graceMs": Int(timeout * 1000) - 1000])
        _ = signal.wait(timeout: .now() + timeout)
    }

    /// Launch unless one runs, then wait for its answer; a launch that exits first is left to its status reader.
    private func attempt() {
        Thread { [self] in
            report(Status(state: "starting", step: "launching"))
            lock.lock()
            let go = !stopping && !running
            if go {
                running = true
                since = Date()
            }
            lock.unlock()
            if go { launch() }
            do {
                guard try waitUp() else { return }
            } catch {
                log.error("backend did not start: \(error.localizedDescription)")
                fail(error.localizedDescription)
                return
            }
            log.info("backend up on \(Self.origin, privacy: .public)")
            report(Status(state: "ready"))
            lock.lock()
            ready = true
            let run = waiting
            waiting.removeAll()
            lock.unlock()
            run.forEach { $0.then() }
        }.start()
    }

    /// Given up on: every view waiting is told why, and the next one to ask starts it again.
    private func fail(_ why: String) {
        lock.lock()
        if stopping {
            lock.unlock()
            return
        }
        failure = why
        ready = false
        let told = waiting
        waiting.removeAll()
        lock.unlock()
        report(Status(state: "failed", message: why))
        told.forEach { $0.failed(why) }
    }

    private var root: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("standalone", isDirectory: true)
    }

    /// The backend's workspaces and médiathèque, which the engine must be allowed to open (engine/k7-runtime/docs/ios.md).
    static var engineRoots: [URL] {
        let dirs = table["dirs"] as? [String: String] ?? [:]
        return ["STUDIO_FILES_ROOT", "STUDIO_MEDIATEK"].compactMap { dirs[$0] }.map { shared.root.appendingPathComponent($0) }
    }

    private var bundle: URL { Bundle.main.resourceURL!.appendingPathComponent("backend", isDirectory: true) }

    /// Generated once and kept, so a session survives a restart.
    private func sessionSecret() -> String {
        let file = root.appendingPathComponent("session-secret")
        if let kept = try? String(contentsOf: file, encoding: .utf8), !kept.isEmpty { return kept }
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let secret = bytes.map { String(format: "%02x", $0) }.joined()
        try? secret.write(to: file, atomically: true, encoding: .utf8)
        return secret
    }

    /// The backend's whole environment: a worker's own copy, so nothing here reaches the engine or the supervisor.
    private func environment() -> [String: String] {
        let fm = FileManager.default
        let home = root.appendingPathComponent("home", isDirectory: true)
        try? fm.createDirectory(at: home, withIntermediateDirectories: true)
        var env: [String: String] = [
            "HOME": home.path,
            "TMPDIR": NSTemporaryDirectory(),
            "PATH": "/usr/bin:/bin",
            "PORT": String(Self.port),
            "STUDIO_PORTS": Self.portsSpec,
            "SESSION_SECRET": sessionSecret(),
            "STUDIO_FILE_SERVICE_ENTRY": bundle.appendingPathComponent("bin/file-service.mjs").path,
            // No app may start a process here: each account's file service is a thread (packages/file-hub/workerChild.ts).
            "STUDIO_FILE_SERVICE_THREADS": "1",
        ]
        // The desktop's table: the public OIDC client, the local user, a host-only cookie.
        for (key, value) in Self.table["env"] as? [String: String] ?? [:] { env[key] = value }
        for (key, value) in Self.table["dirs"] as? [String: String] ?? [:] {
            env[key] = root.appendingPathComponent(value).path
        }
        // The hub copies the library from the bundle the first time it has no folder for it.
        if let library = Self.table["library"] as? String {
            env["STUDIO_LIBRARY_SEED"] = "k7-core=" + bundle.appendingPathComponent(library).path
        }
        return env
    }

    private func send(_ msg: [String: Any]) {
        lock.lock()
        let to = control
        lock.unlock()
        guard let to, var data = try? JSONSerialization.data(withJSONObject: msg) else { return }
        data.append(0x0A)
        try? to.write(contentsOf: data)
    }

    private func launch() {
        startNode()
        send(["t": "start", "entry": bundle.appendingPathComponent("bin/backend.mjs").path, "env": environment()])
    }

    /// Node itself, once: backend-boot.mjs, told the two pipes it is driven over.
    private func startNode() {
        lock.lock()
        if nodeStarted {
            lock.unlock()
            return
        }
        nodeStarted = true
        let toNode = Pipe()
        let fromNode = Pipe()
        control = toNode.fileHandleForWriting
        lock.unlock()
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        // Read once, at node's start: the user's CAs reach the backend at the app's next launch.
        if FileManager.default.fileExists(atPath: TrustedCas.file.path) {
            setenv("NODE_EXTRA_CA_CERTS", TrustedCas.file.path, 1)
        }
        // The k7x reader as an addon, since a JIT-less node has no WebAssembly; every worker inherits it (packages/k7x/docs/rust.md).
        if let k7x = Bundle.main.privateFrameworksURL?.appendingPathComponent("k7x.framework/k7x"),
           FileManager.default.fileExists(atPath: k7x.path) {
            setenv("K7X_ADDON", k7x.path, 1)
        }
        let boot = Bundle.main.resourceURL!.appendingPathComponent("backend-boot.mjs").path
        let args = ["node", boot, String(toNode.fileHandleForReading.fileDescriptor),
                    String(fromNode.fileHandleForWriting.fileDescriptor)]
        let node = Thread {
            Self.runNode(args)
            // Node only returns once boot's control pipe closed, which is the app going away.
            _ = toNode
            _ = fromNode
        }
        node.name = "k7-node"
        // NodeMobile's own advice, and more: V8 without a JIT recurses deeper.
        node.stackSize = 8 << 20
        node.start()
        let reader = Thread { [self] in
            readLines(dup(fromNode.fileHandleForReading.fileDescriptor)) { onStatus($0) }
        }
        reader.name = "k7-node-status"
        reader.start()
    }

    /// node_start with its arguments in ONE block of memory, as libuv's argument handling expects.
    private static func runNode(_ args: [String]) {
        let size = args.reduce(0) { $0 + $1.utf8.count + 1 }
        let block = UnsafeMutablePointer<CChar>.allocate(capacity: size)
        var argv: [UnsafeMutablePointer<CChar>?] = []
        var at = block
        for arg in args {
            argv.append(at)
            arg.withCString { strcpy(at, $0) }
            at += arg.utf8.count + 1
        }
        argv.append(nil)
        _ = argv.withUnsafeMutableBufferPointer { node_start(Int32(args.count), $0.baseAddress) }
    }

    private func onStatus(_ line: String) {
        guard let data = line.data(using: .utf8),
              let msg = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        switch msg["t"] as? String {
        case "error":
            log.error("backend: \(msg["message"] as? String ?? "", privacy: .public)")
        case "exit":
            exited(code: msg["code"] as? Int)
        default:
            break
        }
    }

    /// A crash is relaunched on a doubling delay; after maxQuickExits short runs in a row it is given up on (docs/ios.md).
    private func exited(code: Int?) {
        log.warning("backend exited (\(code ?? -1))")
        lock.lock()
        running = false
        ready = false
        exitSignal?.signal()
        if stopping || failure != nil {
            lock.unlock()
            return
        }
        if Date().timeIntervalSince(since) >= Self.healthy { quickExits = 0 }
        quickExits += 1
        let count = quickExits
        lock.unlock()
        guard count < Self.maxQuickExits else {
            fail("k7's backend stopped \(Self.maxQuickExits) times in a row (last exit code \(code ?? -1))")
            return
        }
        let delay = min(Self.relaunchFirst * pow(2, Double(count - 1)), Self.relaunchMax)
        report(Status(state: "starting", step: "launching"))
        Thread.sleep(forTimeInterval: delay)
        lock.lock()
        let again = !stopping && failure == nil && !running
        lock.unlock()
        if again { attempt() }
    }

    /// Until the backend answers its registry's hello — what the supervisor asks before it connects; false if it exits first.
    private func waitUp() throws -> Bool {
        let end = Date().addingTimeInterval(Self.readyTimeout)
        let url = URL(string: "\(Self.origin)/api/registry/hello")!
        while Date() < end {
            lock.lock()
            let alive = running
            lock.unlock()
            if !alive { return false }
            var request = URLRequest(url: url)
            request.timeoutInterval = 0.5
            let answered = DispatchSemaphore(value: 0)
            var ok = false
            URLSession.shared.dataTask(with: request) { _, response, _ in
                ok = (response as? HTTPURLResponse)?.statusCode == 200
                answered.signal()
            }.resume()
            answered.wait()
            if ok { return true }
            Thread.sleep(forTimeInterval: 0.2)
        }
        throw NSError(domain: "k7", code: 1, userInfo: [
            NSLocalizedDescriptionKey: "no answer on \(Self.origin) within \(Int(Self.readyTimeout)) s",
        ])
    }

    private static let readyTimeout: TimeInterval = 60
    private static let relaunchFirst: TimeInterval = 2
    private static let relaunchMax: TimeInterval = 60
    // A run this long is no crash at boot: the count of quick exits starts over.
    private static let healthy: TimeInterval = 60
    private static let maxQuickExits = 6
}
