// StudioBridge.kt — what the studio apps in AppViewsPlugin's views may ask of this app, over one
// WebMessageListener (`window.k7Android`). Every app reports the colour at the top of its page
// (assets/top-color.js), which paints the status bar above it, who is signed in (assets/account.js), and what it plays
// (assets/media-session.js, to MediaPlayback), and the files it saves (assets/download.js, to Downloads); ONLY k7, checked by origin, reaches
// the engine: its settings panel is this phone's tray (apps/k7/frontend/src/settings/androidEngine.ts).
// The object is offered to every origin, since the studio can change; each message is checked instead.
// k7's origin may be a remote studio, so it gets a short list of commands, and a new studio needs the user's yes.
// See docs/android.md.

package se.frediver.k7

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.util.Log
import android.webkit.WebView
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

class StudioBridge(
    private val activity: AppCompatActivity,
    /** Which app an origin is, or null for anywhere else. */
    private val appOf: (Uri) -> String?,
    private val onColor: (id: String, color: Int) -> Unit,
    /** Who the studio says is signed in, null for nobody (assets/account.js). */
    private val onAccount: (name: String?) -> Unit,
    private val onChooseStudio: (origin: String) -> Unit,
) : SupervisorHost.Listener {
    // The k7 page listening now: a reload hands over a new one with its `listen`.
    private var k7: JavaScriptReplyProxy? = null
    private var studio: String? = null
    private var pickedCa: ((Uri?) -> Unit)? = null
    // One confirmation on screen at a time: a page asking again while one is up is refused, not queued.
    private var asking = false
    private val downloads = Downloads(activity)
    private val pickCa: ActivityResultLauncher<Intent> =
        activity.activityResultRegistry.register("k7-bridge-ca", ActivityResultContracts.StartActivityForResult()) {
            val uri = if (it.resultCode == android.app.Activity.RESULT_OK) it.data?.data else null
            pickedCa?.invoke(uri)
            pickedCa = null
        }

    init {
        SupervisorHost.listen(this)
    }

    fun destroy() {
        SupervisorHost.unlisten(this)
        pickCa.unregister()
        downloads.destroy()
    }

    /** The studio the views open now, k7's origin; the panel marks it. */
    fun setStudio(origin: String?) {
        if (origin == studio) return
        studio = origin
        push()
    }

    fun attach(view: WebView, id: String) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(view, NAME, setOf("*")) { _, message, origin, isMainFrame, reply ->
            // The view's own app and nothing else: a page it wandered off to gets no answer.
            if (!isMainFrame || appOf(origin) != id) return@addWebMessageListener
            val msg = runCatching { JSONObject(message.data ?: "") }.getOrNull() ?: return@addWebMessageListener
            when (msg.optString("t")) {
                "color" -> runCatching { Color.parseColor(msg.getString("value")) }.onSuccess { onColor(id, it) }
                "account" -> onAccount(if (msg.isNull("name")) null else msg.optString("name"))
                "media" -> MediaPlayback.update(activity, msg, reply)
                "dl-start", "dl-chunk", "dl-end", "dl-fail" -> downloads.onMessage(msg, reply)
                "listen" -> if (id == "k7") {
                    k7 = reply
                    push()
                }
                "call" -> if (id == "k7") call(reply, msg.optInt("id"), msg.optString("method"), msg.optJSONObject("arg") ?: JSONObject())
            }
        }
    }

    override fun onState(frame: JSONObject) = push()

    override fun onEngineExit(code: Int) = push()

    private fun push() {
        val (state, exit) = SupervisorHost.known()
        val snapshot = JSONObject().put("t", "snapshot").put("studio", studio ?: JSONObject.NULL)
        state?.let { snapshot.put("state", it) }
        exit?.let { snapshot.put("engineExit", it) }
        activity.runOnUiThread { k7?.postMessage(snapshot.toString()) }
    }

    private fun call(reply: JavaScriptReplyProxy, id: Int, method: String, arg: JSONObject) {
        val answer = { done: Result<JSONObject> ->
            val out = JSONObject().put("t", "reply").put("id", id).put("ok", done.isSuccess)
            done.fold({ out.put("value", it) }, { out.put("error", it.message ?: "failed") })
            activity.runOnUiThread { reply.postMessage(out.toString()) }
        }
        val ok = { value: JSONObject -> answer(Result.success(value)) }
        when (method) {
            "command" -> command(arg.optString("cmd"), arg.optString("arg"), answer)
            "lanAddress" -> ok(JSONObject().apply { EngineOps.lanAddress(activity)?.let { put("address", it) } })
            "casInfo" -> ok(JSONObject().put("count", TrustedCas.count(activity)))
            "importCa" -> {
                pickedCa = { uri ->
                    if (uri == null) ok(JSONObject().put("said", "").put("count", TrustedCas.count(activity)))
                    else EngineOps.importCa(activity, uri, answer)
                }
                pickCa.launch(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"))
            }
            "forgetCas" -> EngineOps.forgetCas(activity, answer)
            "chooseStudio" -> chooseStudio(arg.optString("origin"), answer)
            "quit" -> {
                ok(JSONObject())
                activity.runOnUiThread { activity.finish() }
            }
            else -> answer(Result.failure(IllegalArgumentException("no method $method")))
        }
    }

    private fun command(cmd: String, arg: String, answer: (Result<JSONObject>) -> Unit) {
        val send = {
            SupervisorHost.command(cmd, arg)
            answer(Result.success(JSONObject()))
        }
        when (cmd) {
            in ALLOWED -> send()
            // A new studio is where this engine registers and k7 may then open: never added on a page's word alone.
            "weburi.add" -> if (isStudioUrl(arg)) {
                confirm("Connect this phone's engine to the studio at\n\n$arg ?", "Connect", send, answer)
            } else {
                Log.w(TAG, "refused studio address from k7's page: $arg")
                answer(Result.failure(IllegalArgumentException("not a studio address")))
            }
            else -> {
                Log.w(TAG, "refused command from k7's page: $cmd")
                answer(Result.failure(SecurityException("command $cmd is not allowed")))
            }
        }
    }

    private fun chooseStudio(origin: String, answer: (Result<JSONObject>) -> Unit) {
        val uri = Uri.parse(origin)
        val host = uri.host
        if (!isStudioUrl(origin) || host.isNullOrEmpty() || !(uri.scheme == "https" || isLoopback(host))) {
            Log.w(TAG, "refused studio $origin: https only, but for this phone's own")
            return answer(Result.failure(SecurityException("a studio must be https")))
        }
        val open = {
            onChooseStudio(origin)
            answer(Result.success(JSONObject()))
        }
        if (isLoopback(host) || listed(uri)) open() else confirm("Open k7 on the studio at\n\n$origin ?", "Open", open, answer)
    }

    /** Whether `origin` is one of the studios the supervisor lists: the host itself, or the family above a `play.`/`k7.` alias. */
    private fun listed(origin: Uri): Boolean {
        val instances = SupervisorHost.known().first?.optJSONArray("instances") ?: return false
        val host = origin.host?.lowercase() ?: return false
        return (0 until instances.length()).any { i ->
            val url = Uri.parse(instances.optJSONObject(i)?.optString("url") ?: "")
            val h = url.host?.lowercase()
            url.scheme == origin.scheme && h != null && (h == host || h.endsWith(".$host"))
        }
    }

    // The user's yes in a native dialog, which a page can neither draw nor click; a dismissal is a no.
    private fun confirm(question: String, yes: String, onYes: () -> Unit, answer: (Result<JSONObject>) -> Unit) {
        activity.runOnUiThread {
            if (asking || activity.isFinishing) return@runOnUiThread answer(Result.failure(SecurityException("busy")))
            asking = true
            var said = false
            AlertDialog.Builder(activity)
                .setTitle("k7")
                .setMessage(question)
                .setPositiveButton(yes) { _, _ -> said = true }
                .setNegativeButton("Cancel", null)
                .setOnDismissListener {
                    asking = false
                    if (said) onYes() else answer(Result.failure(SecurityException("declined")))
                }
                .show()
        }
    }

    companion object {
        const val NAME = "k7Android"
        private const val TAG = "k7-bridge"

        /** The desktop's list (apps/k7-standalone/src/engineBridge.ts), plus removing a studio, which only unlists this engine. */
        private val ALLOWED = setOf(
            "engine.start", "engine.stop", "engine.restart", "audio.priority",
            "plugins.rescan", "instruments.download", "instruments.remove", "weburi.remove",
        )

        // An address the dialog can show as it is: http(s), a host, short, and no whitespace to forge lines with.
        private fun isStudioUrl(url: String): Boolean {
            val uri = Uri.parse(url)
            return url.length <= 200 && url.none(Char::isWhitespace) && uri.scheme in setOf("http", "https") && !uri.host.isNullOrEmpty()
        }

        private fun isLoopback(host: String) =
            host.lowercase().removePrefix("[").removeSuffix("]") in setOf("localhost", "127.0.0.1", "::1")
    }
}
