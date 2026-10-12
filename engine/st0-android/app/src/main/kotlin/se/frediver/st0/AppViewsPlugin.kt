// AppViewsPlugin.kt — the studio apps, each in a full-screen WebView of its own over the shell page (web/src/App.tsx,
// AppViews), under a status-bar strip painted the colour of the app's own header (StudioBridge.kt). They load from
// the connected studio rather than from this APK: each app is same-origin with its backend (`/api`, `/auth`, cookie
// sessions), so a bundled copy would be an app with no server. A view is made the first time it is shown and then
// only hidden, so an app keeps its state — a rehearsal take, a track playing in st0's media library — while another is on screen.
// See docs/android.md.

package se.frediver.st0

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
    private lateinit var appBridge: StudioBridge
    private val colors = mutableMapOf<String, Int>()
    private var lightBarsBefore = false
    private lateinit var topColorJs: String
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
        appBridge = StudioBridge(
            activity,
            ::appOf,
            onColor = { id, color ->
                colors[id] = color
                if (id == visible) paint()
            },
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

        pickFiles = activity.activityResultRegistry.register("st0-app-files", ActivityResultContracts.StartActivityForResult()) {
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
        bridge.executeOnMainThread {
            apps = given.keys().asSequence().associateWith { Uri.parse(given.getString(it)) }
            val home = apps[id]?.toString() ?: return@executeOnMainThread call.reject("no address for $id")
            appBridge.setStudio(studio)
            val view = views.getOrPut(id) { create(id) }
            when {
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
        settings.userAgentString = "${settings.userAgentString} st0-android"
        webViewClient = AppClient(id)
        webChromeClient = AppChrome()
        setDownloadListener { url, _, _, _, _ -> openOutside(Uri.parse(url)) }
        appBridge.attach(this, id)
        frame.addView(
            this,
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT).apply { topMargin = topPx },
        )
    }

    /** Which app `url` is one of, by origin; null for anywhere else. */
    private fun appOf(url: Uri): String? =
        apps.entries.firstOrNull { (_, home) -> home.scheme == url.scheme && home.host == url.host && home.port == url.port }?.key

    /** Somewhere this app does not show: the browser, the mail app, whatever claims it. */
    private fun openOutside(url: Uri) {
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
            // Nothing handles it: the link just does nothing.
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
            // Only a link the user followed moves tabs. A redirect or a script's navigation stays put: the
            // sign-in flow bounces a view through st0's /auth and back, and must not be torn out of it.
            if (!request.isForMainFrame || !request.hasGesture() || request.isRedirect) return false
            val to = appOf(url) ?: return false
            if (to == id) return false
            navigate(to, url)
            return true
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) = syncBack()

        override fun onPageFinished(view: WebView, url: String?) = view.evaluateJavascript(topColorJs, null)

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
        // The microphone, for the rehearsal recorder's remote mic and calls: granted to the studio's own apps only, and only
        // once the app holds RECORD_AUDIO itself (asked at start, for the engine).
        override fun onPermissionRequest(request: PermissionRequest) {
            val mic = context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            val grant = request.resources.filter {
                it == PermissionRequest.RESOURCE_AUDIO_CAPTURE && mic && appOf(request.origin) != null
            }
            activity.runOnUiThread {
                if (grant.isEmpty()) request.deny() else request.grant(grant.toTypedArray())
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
}
