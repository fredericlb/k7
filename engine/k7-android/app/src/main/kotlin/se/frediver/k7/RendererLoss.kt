// RendererLoss.kt — a WebView renderer that dies (killed for memory, or crashed) ends the whole process unless every
// view it drew says it handled the loss, and the engine lives in that process. Every view of an app shares one
// renderer, so the shell page's view goes with the apps': the activity is made again around a new one, and each app
// lost shows the shell's Retry rather than reloading into the same loss. See docs/android.md.

package se.frediver.k7

import android.app.Activity
import android.os.SystemClock
import android.util.Log
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import com.getcapacitor.WebViewListener

/** Process-wide: the activity, its bridge and its plugin are all made again after a loss. */
object RendererLoss {
    private const val TAG = "k7-views"
    // Made again this often in a minute, the shell page itself is what dies: a restart is offered instead.
    private const val MAX_SHELL_REMAKES = 3
    private const val WINDOW_MS = 60_000L
    private val remakes = ArrayDeque<Long>()
    // Each app whose view was lost, with the plugin it was lost under and why.
    private val lostIn = mutableMapOf<String, Pair<Int, String>>()
    private var generations = 0

    /** A new plugin's number, which it passes to `lost` and `unseen`. */
    @Synchronized
    fun nextGeneration(): Int = ++generations

    /** What the shell page is told. */
    fun why(detail: RenderProcessGoneDetail): String =
        if (detail.didCrash()) "the page crashed" else "the page was stopped to free memory"

    /** `id`'s view lost its renderer under the plugin numbered `generation`. */
    @Synchronized
    fun lost(id: String, generation: Int, why: String) {
        Log.w(TAG, "$id lost its renderer: $why")
        lostIn[id] = generation to why
    }

    /** Why `id`'s view was lost, if a plugin before `generation` lost it and so never told this page; asked once. */
    @Synchronized
    fun unseen(id: String, generation: Int): String? {
        val (at, why) = lostIn.remove(id) ?: return null
        return why.takeIf { at != generation }
    }

    /** The bridge's own view: its renderer gone is the activity made again, after `onLost` marked the apps it drew. */
    fun shell(activity: Activity, shellView: WebView, onLost: (String) -> Unit): WebViewListener = object : WebViewListener() {
        override fun onRenderProcessGone(webView: WebView, detail: RenderProcessGoneDetail): Boolean {
            if (webView !== shellView) return false
            val why = why(detail)
            Log.w(TAG, "the shell page lost its renderer: $why")
            onLost(why)
            if (tooOften()) Relaunch.offer("renderer", "k7's screen keeps stopping ($why). Restart k7?")
            else activity.window.decorView.post { if (!activity.isFinishing && !activity.isDestroyed) activity.recreate() }
            return true
        }
    }

    @Synchronized
    private fun tooOften(): Boolean {
        val now = SystemClock.elapsedRealtime()
        while (remakes.isNotEmpty() && now - remakes.first() > WINDOW_MS) remakes.removeFirst()
        remakes.addLast(now)
        return remakes.size > MAX_SHELL_REMAKES
    }
}
