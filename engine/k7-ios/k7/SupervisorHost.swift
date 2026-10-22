// SupervisorHost.swift — the app's half of the supervisor's NDJSON channel: what packages/supervisor-host/src/supervisorHost.ts
// is on desktop. No iOS app may run a program of its own, so the supervisor is k7supervisor.framework, run on a
// thread of its own over two pipes; and the engine is a library here too, so the supervisor's `engine` requests
// are this app's to carry out. See engine/k7-runtime/docs/ios.md.

import Foundation
import os
import UIKit

/// What a page draws: the latest snapshot, and the engine's exit code once it stopped.
protocol SupervisorListener: AnyObject {
    func onState(_ frame: [String: Any])
    func onEngineExit(_ code: Int)
}

/// One per PROCESS, like the engine: a second supervisor would be refused by the host lock.
final class SupervisorHost {
    static let shared = SupervisorHost()

    private let log = Logger(subsystem: "se.frediver.k7", category: "k7-supervisor")
    private let lock = NSLock()
    private struct Run {
        let generation: Int
        let commands: FileHandle
        let done: DispatchSemaphore
    }
    private var run: Run?
    private var generation = 0
    private var nextId = 1
    private var listeners: [ObjectIdentifier: () -> SupervisorListener?] = [:]
    private var lastState: [String: Any]?
    private var engineExit: Int?
    private var restarting = false
    private var stopping = false
    private var relaunchDelay = relaunchFirst
    private var machineName: String?

    private init() {}

    /// Start once per process; a later call while one runs does nothing. The first call is the app's, on the main thread.
    func start() {
        if machineName == nil { machineName = Self.deviceName }
        lock.lock()
        defer { lock.unlock() }
        if run != nil { return }
        stopping = false
        launch()
    }

    // Called with the lock held.
    private func launch() {
        pinLocalStudio()
        setenv("STUDIO_HOME", EngineBridge.stateDir.path, 1)
        setenv("STUDIO_MACHINE_NAME", machineName ?? "iPhone", 1)
        // The local backend's port, which the supervisor reads to reach a loopback registry.
        setenv("STUDIO_PORTS", BackendHost.portsSpec, 1)
        // No app may list iOS's roots, so the supervisor trusts the bundle this app ships, plus the user's own.
        setenv("STUDIO_SYSTEM_CA_CERTS", Bundle.main.resourceURL!.appendingPathComponent("cacert.pem").path, 1)
        if FileManager.default.fileExists(atPath: TrustedCas.file.path) {
            setenv("STUDIO_EXTRA_CA_CERTS", TrustedCas.file.path, 1)
        } else {
            unsetenv("STUDIO_EXTRA_CA_CERTS")
        }
        let commands = Pipe()
        let frames = Pipe()
        generation += 1
        let g = generation
        let done = DispatchSemaphore(value: 0)
        run = Run(generation: g, commands: commands.fileHandleForWriting, done: done)
        let commandsIn = commands.fileHandleForReading.fileDescriptor
        let framesOut = frames.fileHandleForWriting.fileDescriptor
        let since = Date()
        let runner = Thread { [self] in
            let code = Int(k7_supervisor_run(commandsIn, framesOut))
            // Its end of each pipe: the frame reader then sees the end, and nothing holds the descriptors.
            try? frames.fileHandleForWriting.close()
            try? commands.fileHandleForReading.close()
            done.signal()
            watch(g, code: code, since: since)
        }
        runner.name = "k7-supervisor"
        runner.stackSize = 4 << 20
        runner.start()
        let reader = Thread { [self] in
            readLines(dup(frames.fileHandleForReading.fileDescriptor)) { onFrame(g, $0) }
            try? frames.fileHandleForReading.close()
        }
        reader.name = "k7-supervisor-out"
        reader.start()
    }

    /// A supervisor that returns unasked is started again on a doubling delay, reset by a healthy run.
    private func watch(_ g: Int, code: Int, since: Date) {
        lock.lock()
        // Replaced by restart(), or quit on purpose: nothing to bring back.
        guard run?.generation == g, !stopping else {
            lock.unlock()
            return
        }
        run = nil
        if Date().timeIntervalSince(since) >= Self.healthy { relaunchDelay = Self.relaunchFirst }
        let delay = relaunchDelay
        relaunchDelay = min(delay * 2, Self.relaunchMax)
        lock.unlock()
        log.warning("supervisor returned (\(code)), started again in \(delay) s")
        down("the supervisor stopped (\(code)), restarting…")
        Thread.sleep(forTimeInterval: delay)
        lock.lock()
        if !stopping && run == nil { launch() }
        lock.unlock()
    }

    /// The last snapshot, marked down, so a page shows why the engine's line went stale rather than its old status.
    private func down(_ why: String) {
        lock.lock()
        var frame = lastState ?? ["t": "state"]
        frame["status"] = "error"
        frame["error"] = why
        lastState = frame
        let to = watchers()
        lock.unlock()
        to.forEach { $0.onState(frame) }
    }

    /// One more watcher, told at once what is already known.
    func listen(_ l: SupervisorListener) {
        lock.lock()
        listeners[ObjectIdentifier(l)] = { [weak l] in l }
        let state = lastState
        let exit = engineExit
        lock.unlock()
        if let state { l.onState(state) }
        if let exit { l.onEngineExit(exit) }
    }

    func unlisten(_ l: SupervisorListener) {
        lock.lock()
        listeners[ObjectIdentifier(l)] = nil
        lock.unlock()
    }

    // Called with the lock held.
    private func watchers() -> [SupervisorListener] {
        listeners.values.compactMap { $0() }
    }

    /// What is already known, for a page that asks before it listens: the latest snapshot and the engine's exit code.
    func known() -> (state: [String: Any]?, engineExit: Int?) {
        lock.lock()
        defer { lock.unlock() }
        return (lastState, engineExit)
    }

    /// One command, as the tray sends it: `arg` is always one string.
    func command(_ cmd: String, _ arg: String = "") {
        lock.lock()
        defer { lock.unlock() }
        guard let run else { return }
        let line: [String: Any] = ["t": "cmd", "id": nextId, "cmd": cmd, "arg": arg]
        nextId += 1
        guard var data = try? JSONSerialization.data(withJSONObject: line) else { return }
        data.append(0x0A)
        do {
            try run.commands.write(contentsOf: data)
        } catch {
            log.warning("supervisor gone: \(error.localizedDescription)")
        }
    }

    /// A new supervisor for what only its start reads — the trusted CAs; the engine keeps serving, and the new one adopts it.
    func restart(timeout: TimeInterval) {
        lock.lock()
        restarting = true
        lock.unlock()
        stop(timeout: timeout)
        lock.lock()
        run = nil
        restarting = false
        lock.unlock()
        start()
    }

    /// Close the command pipe, which IS the supervisor's quit: it deregisters, asks the engine to stop, and returns.
    func stop(timeout: TimeInterval) {
        lock.lock()
        stopping = true
        let current = run
        lock.unlock()
        guard let current else { return }
        try? current.commands.close()
        if current.done.wait(timeout: .now() + timeout) == .timedOut {
            // A thread cannot be killed: the next start finds it still holding the host lock, and says so.
            log.error("the supervisor did not return within \(timeout) s")
        }
    }

    private func onFrame(_ g: Int, _ line: String) {
        guard let data = line.data(using: .utf8),
              let frame = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        switch frame["t"] as? String {
        case "state":
            // A replaced supervisor's last frames would cover the line that says it is down.
            lock.lock()
            let current = run?.generation == g
            if current { lastState = frame }
            let to = watchers()
            lock.unlock()
            if current { to.forEach { $0.onState(frame) } }
        case "engine":
            // Only the CURRENT supervisor's: a restarted one's last words — "stop the engine" — may still be in its pipe.
            lock.lock()
            let obey = run?.generation == g && !restarting
            lock.unlock()
            if obey { onEngine(frame) }
        case "result":
            if frame["ok"] as? Bool == false {
                log.warning("command \(frame["id"] as? Int ?? 0): \(frame["message"] as? String ?? "")")
            }
        default:
            break
        }
    }

    private func onEngine(_ frame: [String: Any]) {
        switch frame["action"] as? String {
        case "start":
            guard let id = frame["id"] as? String, let token = frame["token"] as? String,
                  let port = frame["port"] as? Int else { return }
            EngineBridge.start(
                id: id, token: token, port: port,
                host: frame["host"] as? String ?? "0.0.0.0",
                origins: frame["origins"] as? String ?? ""
            ) { [self] code in
                lock.lock()
                engineExit = code
                let to = watchers()
                lock.unlock()
                to.forEach { $0.onEngineExit(code) }
            }
        case "stop":
            // Off the reader thread: the wait would hold up every frame behind it.
            Thread { _ = EngineBridge.stop(timeout: Self.engineStop) }.start()
        default:
            break
        }
    }

    private var settingsFile: URL { EngineBridge.stateDir.appendingPathComponent("engine-host.json") }

    private func readSettings() -> [String: Any] {
        guard let data = try? Data(contentsOf: settingsFile) else { return [:] }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    // Beside, then moved over: the supervisor reads this file, and must never find half of it.
    private func writeSettings(_ settings: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: settings, options: [.prettyPrinted]) else { return }
        try? data.write(to: settingsFile, options: .atomic)
    }

    /// The phone's own backend in the studio list, before the supervisor reads it: the app is standalone, other studios come in addition.
    private func pinLocalStudio() {
        var settings = readSettings()
        let urls = settings["registryUrls"] as? [String] ?? []
        if urls.contains(BackendHost.origin) { return }
        // First, so a phone with nothing chosen yet opens its own studio.
        settings["registryUrls"] = [BackendHost.origin] + urls
        writeSettings(settings)
    }

    /// The device token `origin` paired this phone with: told to a running supervisor, which lists the engine there, and kept for its next start.
    func rememberDeviceToken(origin: String, token: String) {
        if origin.isEmpty || token.isEmpty { return }
        lock.lock()
        var settings = readSettings()
        var tokens = settings["deviceTokens"] as? [String: String] ?? [:]
        tokens[origin] = token
        settings["deviceTokens"] = tokens
        writeSettings(settings)
        lock.unlock()
        // Outside the lock, which `command` takes: a running supervisor saves its own settings over the file, and keeps this.
        command("weburi.pair", "\(origin)\u{1f}\(token)")
    }

    // What the picker shows for this engine: the name iOS gives an app, which is the model unless entitled to more.
    private static var deviceName: String {
        Thread.isMainThread ? UIDevice.current.name : "iPhone"
    }

    private static let engineStop: TimeInterval = 3
    // The desktop host's bounds (packages/supervisor-host/src/supervisorHost.ts).
    private static let relaunchFirst: TimeInterval = 1
    private static let relaunchMax: TimeInterval = 30
    private static let healthy: TimeInterval = 20
}
