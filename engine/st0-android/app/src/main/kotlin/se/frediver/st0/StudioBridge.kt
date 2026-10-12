// StudioBridge.kt — what the studio apps in AppViewsPlugin's views may ask of this app, over one
// WebMessageListener (`window.st0Android`). Every app reports the colour at the top of its page
// (assets/top-color.js), which paints the status bar above it, and who is signed in (assets/account.js); ONLY st0, checked by origin, reaches
// the engine: its settings panel is this phone's tray (apps/st0/frontend/src/settings/androidEngine.ts).
// The object is offered to every origin, since the studio can change; each message is checked instead.
// See docs/android.md.

package se.frediver.st0

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.webkit.WebView
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
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
    // The st0 page listening now: a reload hands over a new one with its `listen`.
    private var st0: JavaScriptReplyProxy? = null
    private var studio: String? = null
    private var pickedCa: ((Uri?) -> Unit)? = null
    private val pickCa: ActivityResultLauncher<Intent> =
        activity.activityResultRegistry.register("st0-bridge-ca", ActivityResultContracts.StartActivityForResult()) {
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
    }

    /** The studio the views open now, st0's origin; the panel marks it. */
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
                "listen" -> if (id == "st0") {
                    st0 = reply
                    push()
                }
                "call" -> if (id == "st0") call(reply, msg.optInt("id"), msg.optString("method"), msg.optJSONObject("arg") ?: JSONObject())
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
        activity.runOnUiThread { st0?.postMessage(snapshot.toString()) }
    }

    private fun call(reply: JavaScriptReplyProxy, id: Int, method: String, arg: JSONObject) {
        val answer = { done: Result<JSONObject> ->
            val out = JSONObject().put("t", "reply").put("id", id).put("ok", done.isSuccess)
            done.fold({ out.put("value", it) }, { out.put("error", it.message ?: "failed") })
            activity.runOnUiThread { reply.postMessage(out.toString()) }
        }
        val ok = { value: JSONObject -> answer(Result.success(value)) }
        when (method) {
            "command" -> {
                SupervisorHost.command(arg.optString("cmd"), arg.optString("arg"))
                ok(JSONObject())
            }
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
            "chooseStudio" -> {
                onChooseStudio(arg.optString("origin"))
                ok(JSONObject())
            }
            "quit" -> {
                ok(JSONObject())
                activity.runOnUiThread { activity.finish() }
            }
            else -> answer(Result.failure(IllegalArgumentException("no method $method")))
        }
    }

    companion object {
        const val NAME = "st0Android"
    }
}
