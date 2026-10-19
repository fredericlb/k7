// MainViewController.swift — the Capacitor bridge that hosts the shell page (engine/k7-android/web, the same page
// Android shows) and registers its two plugins, the page's only way to the native half. Its status bar follows
// the app on screen: light icons over a dark header, dark over a light one. See engine/k7-runtime/docs/ios.md.

import Capacitor
import UIKit

final class MainViewController: CAPBridgeViewController {
    /// The controller alive now, for what sets the status bar from elsewhere.
    static weak var current: MainViewController?

    /// Dark status-bar icons, over a light app header; set by AppViews from the colour it paints.
    var statusBarDark = false {
        didSet { if statusBarDark != oldValue { setNeedsStatusBarAppearanceUpdate() } }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        statusBarDark ? .darkContent : .lightContent
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        Self.current = self
        // The splash's #07031F, so the launch screen hands over to the shell page with no flash.
        view.backgroundColor = UIColor(red: 7 / 255, green: 3 / 255, blue: 31 / 255, alpha: 1)
        webView?.isOpaque = false
        webView?.backgroundColor = .clear
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(EnginePlugin())
        bridge?.registerPluginInstance(AppViewsPlugin())
    }
}
