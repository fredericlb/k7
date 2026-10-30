// WindowProbe.kt — what AppViewsPlugin answers a page's target=_blank or window.open with: a new window is never
// opened. A throwaway view, never shown, learns where it was headed; that address is routed, and the view destroyed.

package se.frediver.k7

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

object WindowProbe {
    private val main = Handler(Looper.getMainLooper())

    /** onCreateWindow's answer: `route` gets the first address the new window would load. */
    fun answer(context: Context, resultMsg: Message, route: (Uri) -> Unit) {
        val probe = WebView(context)
        probe.webViewClient = object : WebViewClient() {
            private var done = false

            private fun once(url: Uri?) {
                if (done) return
                done = true
                url?.let(route)
                main.post { probe.destroy() }
            }

            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                once(request.url)
                return true
            }

            override fun onPageStarted(v: WebView, url: String?, favicon: Bitmap?) {
                if (url != null && url != "about:blank") once(Uri.parse(url))
            }

            // Its renderer is every view's: unclaimed, the loss would end the process (RendererLoss.kt).
            override fun onRenderProcessGone(v: WebView, detail: RenderProcessGoneDetail): Boolean {
                once(null)
                return true
            }
        }
        (resultMsg.obj as WebView.WebViewTransport).webView = probe
        resultMsg.sendToTarget()
    }
}
