// AppViewsPlugin.kt — the studio apps, each in a full-screen WebView of its own over the shell page (web/src/App.tsx,
// AppViews), under a status-bar strip painted the colour of the app's own header; who is signed in is k7's home page's. They load from
// the connected studio rather than from this APK: each app is same-origin with its backend (`/api`, `/auth`, cookie
// sessions), so a bundled copy would be an app with no server. A view is made the first time it is shown and then
// only hidden, so an app keeps its state — a rehearsal take, a track playing in k7's media library — while another is on screen.
// See docs/android.md.

package se.frediver.k7

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Message
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.graphics.ColorUtils
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "AppViews")
class AppViewsPlugin : Plugin() {
    private lateinit var frame: FrameLayout
    // Under the status bar, in the visible app's top colour.
    private lateinit var strip: View
    private var studio: String? = null
    private lateinit var appBridge: StudioBridge
    private val colors = mutableMapOf<String, Int>()
    private var lightBarsBefore = false
    private lateinit var topColorJs: String
    private lateinit var accountJs: String
    private lateinit var mediaSessionJs: String
    private val views = mutableMapOf<String, WebView>()
    // The address each view was last pointed at by `apps`: a changed studio reloads it, a tab switch does not.
    private val loaded = mutableMapOf<String, String>()
    private var apps: Map<String, Uri> = emptyMap()
    private var visible: String? = null
    private var topPx = 0
    private var bottomPx = 0
    private lateinit var back: OnBackPressedCallback
    private lateinit var pickFiles: ActivityResultLauncher<Intent>
    private var chooser: ValueCallback<Array<Uri>>? = null
    private var localSignInAt = 0L
    // A sign-in the browser answered before k7's view existed — the process was killed behind it: the view's first load.
    private var pendingRedeem: String? = null

    override fun load() {
        // Over the page's WebView, in the same layout, the whole screen: the shell page is only seen with no studio.
        frame = FrameLayout(context).apply { visibility = View.GONE }
        (bridge.webView.parent as ViewGroup).addView(
            frame,
            ViewGroup.MarginLayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        strip = View(context)
        frame.addView(strip, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, 0))
        // The views start below the status bar and the cutout, and stop short of the navigation bar and the keyboard.
        ViewCompat.setOnApplyWindowInsetsListener(frame) { _, insets ->
            topPx = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()).top
            bottomPx = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime()).bottom
            place()
            insets
        }
        lightBarsBefore = barIcons().isAppearanceLightStatusBars
        topColorJs = context.assets.open("top-color.js").bufferedReader().use { it.readText() }
        accountJs = context.assets.open("account.js").bufferedReader().use { it.readText() }
        mediaSessionJs = context.assets.open("media-session.js").bufferedReader().use { it.readText() }
        appBridge = StudioBridge(
            activity,
            ::appOf,
            onColor = { id, color ->
                colors[id] = color
                if (id == visible) paint()
            },
            onAccount = { name -> activity.runOnUiThread { onAccount(name) } },
            onChooseStudio = { notifyListeners("studio", JSObject().put("origin", it)) },
        )

        // Back walks the visible app's history first; with none left, the activity's own back — which quits, as before.
        back = object : OnBackPressedCallback(false) {
            override fun handleOnBackPressed() {
                views[visible]?.takeIf { it.canGoBack() }?.goBack()
                syncBack()
            }
        }
        activity.onBackPressedDispatcher.addCallback(activity, back)

        // Launched BY the browser's answer: no new intent will carry it.
        activity.intent?.data?.let { answer -> AuthHandoff.redeemUrl(context, answer, "/")?.let { pendingRedeem = it } }

        pickFiles = activity.activityResultRegistry.register("k7-app-files", ActivityResultContracts.StartActivityForResult()) {
            chooser?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(it.resultCode, it.data))
            chooser = null
        }
    }

    override fun handleOnPause() {
        // A session cookie set a moment ago must survive the process ending: this app ends it on every quit.
        CookieManager.getInstance().flush()
    }

    override fun handleOnDestroy() {
        appBridge.destroy()
        pickFiles.unregister()
        views.values.forEach { it.destroy() }
        views.clear()
    }

    @PluginMethod
    fun show(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("no id")
        val given = call.getObject("apps") ?: return call.reject("no apps")
        val url = call.getString("url")
        val studio = call.getString("studio")
        // The phone's own studio is not up yet on a first run, which is still unpacking: wait rather than fail.
        if (studio == BackendHost.ORIGIN) BackendHost.whenReady(
            { bridge.executeOnMainThread { show(call, id, given, url, studio) } },
            // Given up on (BackendHost.kt): the shell page's retry is what asks it to start again.
            { why -> bridge.executeOnMainThread { loadFailed(id, why); call.resolve() } },
        )
        else bridge.executeOnMainThread { show(call, id, given, url, studio) }
    }

    private fun show(call: PluginCall, id: String, given: JSObject, url: String?, studio: String?) {
        apps = given.keys().asSequence().associateWith { Uri.parse(given.getString(it)) }
        val address = apps[id]?.toString() ?: return call.reject("no address for $id")
        // On the phone's own studio a view opens as the local user, as the desktop window does.
        val home = if (studio == BackendHost.ORIGIN && id == "k7") BackendHost.LOCAL_HOME else address
        appBridge.setStudio(studio)
        this.studio = studio
        val view = views.getOrPut(id) { create(id) }
        val redeem = pendingRedeem.takeIf { id == "k7" }
        pendingRedeem = null
        when {
            redeem != null -> view.loadUrl(redeem)
            url != null -> view.loadUrl(url)
            loaded[id] != home -> view.loadUrl(home)
        }
        loaded[id] = home
        views.forEach { (key, v) -> v.visibility = if (key == id) View.VISIBLE else View.GONE }
        visible = id
        frame.visibility = View.VISIBLE
        // A frame that was gone may never have been given the insets.
        ViewCompat.requestApplyInsets(frame)
        place()
        paint()
        view.requestFocus()
        syncBack()
        call.resolve()
    }

    @PluginMethod
    fun hideAll(call: PluginCall) = bridge.executeOnMainThread {
        frame.visibility = View.GONE
        visible = null
        barIcons().isAppearanceLightStatusBars = lightBarsBefore
        bridge.webView.requestFocus()
        syncBack()
        call.resolve()
    }

    @PluginMethod
    fun reload(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("no id")
        bridge.executeOnMainThread {
            views[id]?.reload()
            call.resolve()
        }
    }

    override fun handleOnNewIntent(intent: Intent) {
        super.handleOnNewIntent(intent)
        val answer = intent.data ?: return
        // Back where k7 was: the sign-in is carried into its view, which stays on the page it showed.
        val returnTo = views["k7"]?.url?.let(Uri::parse)?.let { u -> (u.path ?: "/") + (u.query?.let { "?$it" } ?: "") } ?: "/"
        val redeem = AuthHandoff.redeemUrl(context, answer, returnTo) ?: return
        // Straight into the view: a `navigate` to the app already shown changes nothing on the page, and loads nothing.
        val view = views["k7"]
        if (view == null) pendingRedeem = redeem else bridge.executeOnMainThread { view.loadUrl(redeem) }
    }

    /** In the system browser, never in a view: identity providers refuse WebViews (RFC 8252 §8.12). */
    private fun signIn() {
        studio?.let { AuthHandoff.start(activity, it) }
    }

    /** Who the studio says is signed in; on the phone's own studio nobody means back to the local user, as on desktop, and an account pairs. */
    private fun onAccount(name: String?) {
        // A real account on the phone's own studio is paired with the origin, once (SyncPairing.kt).
        if (name != null && studio == BackendHost.ORIGIN) SyncPairing.pairIfNeeded(context, CookieManager.getInstance().getCookie(BackendHost.ORIGIN))
        if (name != null || studio != BackendHost.ORIGIN) return
        val now = System.currentTimeMillis()
        // Once in a while at most: a local sign-in that keeps failing must not reload forever.
        if (now - localSignInAt < LOCAL_SIGN_IN_GAP_MS) return
        localSignInAt = now
        views["k7"]?.loadUrl(BackendHost.LOCAL_HOME)
    }

    private fun place() {
        strip.layoutParams = strip.layoutParams.apply { height = topPx }
        views.values.forEach { v -> v.layoutParams = (v.layoutParams as FrameLayout.LayoutParams).apply { topMargin = topPx } }
        frame.setPadding(0, 0, 0, bottomPx)
    }

    // Until the page has said, the shell page's own background shows through.
    private fun paint() {
        val color = colors[visible] ?: Color.TRANSPARENT
        strip.setBackgroundColor(color)
        if (color != Color.TRANSPARENT) barIcons().isAppearanceLightStatusBars = ColorUtils.calculateLuminance(color) > 0.5
    }

    private fun barIcons() = WindowCompat.getInsetsController(activity.window, activity.window.decorView)

    private fun syncBack() {
        back.isEnabled = views[visible]?.canGoBack() == true
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun create(id: String): WebView = WebView(context).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        // target=_blank and window.open reach onCreateWindow, where a link to a sibling app becomes a tab switch.
        settings.setSupportMultipleWindows(true)
        settings.javaScriptCanOpenWindowsAutomatically = true
        // How an app can tell it is inside this one, should it ever need to.
        settings.userAgentString = "${settings.userAgentString} k7-android"
        webViewClient = AppClient(id)
        webChromeClient = AppChrome()
        setDownloadListener { url, _, _, _, _ -> openOutside(Uri.parse(url)) }
        appBridge.attach(this, id)
        // The phone's own studio is a loopback one, whose pages derive each service's address from this table, as the desktop's preload gives it.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(this, "window.$PORTS_GLOBAL='${BackendHost.PORTS_SPEC}';", setOf(BackendHost.ORIGIN))
            // Before the page's own scripts, which may set a media session as they load; StudioBridge checks the origin.
            WebViewCompat.addDocumentStartJavaScript(this, mediaSessionJs, setOf("*"))
        }
        frame.addView(
            this,
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT).apply { topMargin = topPx },
        )
    }

    /** Which app `url` is one of, by origin; null for anywhere else. */
    private fun appOf(url: Uri): String? =
        apps.entries.firstOrNull { (_, home) -> home.scheme == url.scheme && home.host == url.host && home.port == url.port }?.key

    /** Somewhere this app does not show: the browser, the mail app, the dialer — and only those, by scheme. */
    private fun openOutside(url: Uri) {
        // A page may name any scheme: file:, content: or intent: handed to another app would expose or launch what it should not.
        if (url.scheme?.lowercase() !in OUTSIDE_SCHEMES) return
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
            // Nothing handles it: the link just does nothing.
        } catch (e: RuntimeException) {
            // A refused URI (FileUriExposedException, SecurityException) must not take the app down with it.
            android.util.Log.w("k7-views", "not opened outside: ${e.message}")
        }
    }

    /** A link the user followed into another tab's app: the page switches tab, and that view loads it. */
    private fun navigate(id: String, url: Uri) =
        notifyListeners("navigate", JSObject().put("id", id).put("url", url.toString()))

    /** The studio did not answer: the shell page takes over, with the tray and a retry, since no app is there to reach settings in. */
    private fun loadFailed(id: String, why: String) =
        notifyListeners("loadError", JSObject().put("id", id).put("message", why))

    /** Where a new window was headed: a sibling app's tab, or outside. */
    private fun route(url: Uri) {
        val to = appOf(url)
        if (to != null) navigate(to, url) else openOutside(url)
    }

    private inner class AppClient(private val id: String) : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (url.scheme != "http" && url.scheme != "https") {
                openOutside(url)
                return true
            }
            // The studio's sign-in, however it was reached — a click, a script, a redirect: it goes to the browser.
            if (appOf(url) != null && url.path == "/auth/login") {
                signIn()
                return true
            }
            // Only a link the user followed moves tabs. A redirect or a script's navigation stays put: the
            // handoff's redeem bounces a view through k7's /auth and back, and must not be torn out of it.
            if (!request.isForMainFrame || !request.hasGesture() || request.isRedirect) return false
            val to = appOf(url) ?: return false
            if (to == id) return false
            navigate(to, url)
            return true
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) = syncBack()

        override fun onPageFinished(view: WebView, url: String?) {
            view.evaluateJavascript(topColorJs, null)
            view.evaluateJavascript(accountJs, null)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) loadFailed(id, error.description.toString())
        }

        // A studio behind the user's own CA: the WebView knows only Android's, so the CAs the tray was
        // given (TrustedCas) are asked here — the same ones the supervisor trusts.
        @SuppressLint("WebViewClientOnReceivedSslError")
        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            if (TrustedCas.vouch(context, error)) return handler.proceed()
            handler.cancel()
            // The studio's own certificate, not some embed's: nothing of the app can load.
            if (appOf(Uri.parse(error.url)) == id) loadFailed(id, "the studio's certificate is not trusted")
        }
    }

    private inner class AppChrome : WebChromeClient() {
        // The microphone, to the studio's own apps only, once the app holds RECORD_AUDIO, asked here on first need (MicAccess.kt).
        override fun onPermissionRequest(request: PermissionRequest) {
            val wanted = PermissionRequest.RESOURCE_AUDIO_CAPTURE in request.resources && appOf(request.origin) != null
            activity.runOnUiThread {
                val mic = (activity as? MainActivity)?.mic
                if (!wanted || mic == null) return@runOnUiThread request.deny()
                mic.request { answer ->
                    if (answer == MicAccess.Answer.GRANTED) return@request request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    request.deny()
                    // Blocked for good: the page hears why its getUserMedia failed, beside the native dialog.
                    if (answer == MicAccess.Answer.BLOCKED)
                        views.values.forEach { it.evaluateJavascript("dispatchEvent(new CustomEvent('k7:mic-denied'))", null) }
                }
            }
        }

        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            chooser?.onReceiveValue(null)
            chooser = callback
            try {
                pickFiles.launch(params.createIntent())
            } catch (_: ActivityNotFoundException) {
                chooser = null
                return false
            }
            return true
        }

        // A new window is never opened: a throwaway view learns where it was headed, and that is routed.
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            val probe = WebView(context)
            probe.webViewClient = object : WebViewClient() {
                private var done = false

                private fun once(url: Uri) {
                    if (done) return
                    done = true
                    route(url)
                    probe.post { probe.destroy() }
                }

                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                    once(request.url)
                    return true
                }

                override fun onPageStarted(v: WebView, url: String?, favicon: Bitmap?) {
                    if (url != null && url != "about:blank") once(Uri.parse(url))
                }
            }
            (resultMsg.obj as WebView.WebViewTransport).webView = probe
            resultMsg.sendToTarget()
            return true
        }
    }

    companion object {
        private const val LOCAL_SIGN_IN_GAP_MS = 5_000L
        // web-protocol's PORTS_GLOBAL, the name every page reads the loopback ports from.
        private const val PORTS_GLOBAL = "__STUDIO_PORTS__"
        // What openOutside hands to another app; anything else is dropped.
        private val OUTSIDE_SCHEMES = setOf("http", "https", "mailto", "tel")
    }
}
