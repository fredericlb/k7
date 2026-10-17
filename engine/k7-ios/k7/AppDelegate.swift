// AppDelegate.swift — the app, on an iPhone: starts k7's backend (BackendHost) and the supervisor (which starts the
// engine), and hosts the shell page and, over it, the studio apps in views of their own (MainViewController,
// AppViews). Everything lives in this one process, as long as iOS lets it: Quit stops the supervisor, the backend
// and the engine and ends the process, which is also the only way to restart an engine (EngineBridge).
// See engine/k7-runtime/docs/ios.md.

import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    static let supervisorStop: TimeInterval = 4
    private static let engineStop: TimeInterval = 3
    // Longer than the backend's own 8 s stop, so its file services are not ended mid-teardown (apps/k7/backend/src/server.ts).
    private static let backendStop: TimeInterval = 10

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // First of all: the engine, the supervisor and node write to stdio, which only this makes visible.
        StdioLog.start()
        // The studio the views open, before the engine that lists itself there (BackendHost.swift).
        BackendHost.shared.start()
        // Never held up by the microphone: without it the engine opens its device's outputs only (MicAccess.swift).
        SupervisorHost.shared.start()
        Busy.shared.start()
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = MainViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }

    /// The app's Quit — k7's settings, the tray, a microphone grant: the teardown Android's activity runs, then the end of the process.
    static func quit() {
        MediaPlayback.clear()
        Thread {
            // Supervisor FIRST: it deregisters while the engine and the backend still answer, then asks the engine to stop.
            SupervisorHost.shared.stop(timeout: supervisorStop)
            let backend = Thread { BackendHost.shared.stop(timeout: backendStop) }
            backend.start()
            _ = EngineBridge.stop(timeout: engineStop)
            while backend.isExecuting { Thread.sleep(forTimeInterval: 0.1) }
            exit(0)
        }.start()
    }
}
