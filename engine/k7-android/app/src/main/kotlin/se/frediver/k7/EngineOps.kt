// EngineOps.kt — what the tray does beyond a supervisor command, for its two callers: the shell page's
// tray (EnginePlugin.kt), shown while no studio is connected, and k7's settings panel (StudioBridge.kt).
// A CA change restarts the supervisor, which adopts the running engine. See docs/android.md.

package se.frediver.k7

import android.content.Context
import android.net.ConnectivityManager
import android.net.Uri
import org.json.JSONObject
import java.net.Inet4Address

object EngineOps {
    /** The active network's IPv4, which is what a browser on the same LAN dials. */
    fun lanAddress(context: Context): String? {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        return cm?.getLinkProperties(cm.activeNetwork)?.linkAddresses
            ?.map { it.address }?.filterIsInstance<Inet4Address>()?.firstOrNull()?.hostAddress
    }

    /** Trust the certificate(s) at `uri`; `done` gets `{said, count}`, or the reason it is not a certificate. */
    fun importCa(context: Context, uri: Uri, done: (Result<JSONObject>) -> Unit) {
        runCatching { TrustedCas.import(context, uri) }
            .onSuccess { added ->
                restart(context, if (added.isEmpty()) "already trusted" else "now trusting ${added.joinToString("; ")}", done)
            }
            .onFailure { done(Result.failure(IllegalArgumentException("not a certificate: ${it.message}"))) }
    }

    fun forgetCas(context: Context, done: (Result<JSONObject>) -> Unit) {
        TrustedCas.forget(context)
        restart(context, "trusting Android's CAs only", done)
    }

    // The supervisor reads its roots once, at start: a new one takes the change and adopts the running engine.
    private fun restart(context: Context, said: String, done: (Result<JSONObject>) -> Unit) {
        val app = context.applicationContext
        Thread({
            SupervisorHost.restart(app, MainActivity.SUPERVISOR_STOP_MS)
            done(Result.success(JSONObject().put("said", said).put("count", TrustedCas.count(app))))
        }, "k7-supervisor-restart").start()
    }
}
