// EnginePlugin.kt — the page's way to the supervisor (web/src/native.ts, St0Engine): its snapshots as
// `state` events, the engine's exit as `engineExit`, and the few commands the tray sends. What
// MainActivity drew natively before the page existed; SupervisorHost is unchanged under it.

package se.frediver.st0

import android.content.Intent
import android.net.ConnectivityManager
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.net.Inet4Address

@CapacitorPlugin(name = "St0Engine")
class EnginePlugin : Plugin(), SupervisorHost.Listener {
    override fun load() = SupervisorHost.listen(this)

    override fun handleOnDestroy() = SupervisorHost.listen(null)

    // Not retained: a page that was not listening yet asks getState, and a backlog of stale frames would only replay.
    override fun onState(frame: JSONObject) = notifyListeners("state", JSObject(frame.toString()))

    override fun onEngineExit(code: Int) = notifyListeners("engineExit", JSObject().put("code", code), true)

    @PluginMethod
    fun getState(call: PluginCall) {
        val (state, exit) = SupervisorHost.known()
        call.resolve(JSObject().apply {
            state?.let { put("state", JSObject(it.toString())) }
            exit?.let { put("engineExit", it) }
        })
    }

    @PluginMethod
    fun command(call: PluginCall) {
        val cmd = call.getString("cmd") ?: return call.reject("no cmd")
        SupervisorHost.command(cmd, call.getString("arg") ?: "")
        call.resolve()
    }

    // The active network's IPv4, which is what a browser on the same LAN dials.
    @PluginMethod
    fun lanAddress(call: PluginCall) {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        val address = cm?.getLinkProperties(cm.activeNetwork)?.linkAddresses
            ?.map { it.address }?.filterIsInstance<Inet4Address>()?.firstOrNull()?.hostAddress
        call.resolve(JSObject().apply { address?.let { put("address", it) } })
    }

    @PluginMethod
    fun casInfo(call: PluginCall) = call.resolve(JSObject().put("count", TrustedCas.count(context)))

    @PluginMethod
    fun importCa(call: PluginCall) {
        val pick = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
        startActivityForResult(call, pick, "caPicked")
    }

    @ActivityCallback
    private fun caPicked(call: PluginCall?, result: ActivityResult) {
        call ?: return
        val uri = result.data?.data
        if (result.resultCode != android.app.Activity.RESULT_OK || uri == null)
            return call.resolve(JSObject().put("said", "").put("count", TrustedCas.count(context)))
        runCatching { TrustedCas.import(context, uri) }
            .onSuccess { added ->
                restartSupervisor(call, if (added.isEmpty()) "already trusted" else "now trusting ${added.joinToString("; ")}")
            }
            .onFailure { call.reject("not a certificate: ${it.message}") }
    }

    @PluginMethod
    fun forgetCas(call: PluginCall) {
        TrustedCas.forget(context)
        restartSupervisor(call, "trusting Android's CAs only")
    }

    @PluginMethod
    fun quit(call: PluginCall) {
        call.resolve()
        activity.runOnUiThread { activity.finish() }
    }

    // The supervisor reads its roots once, at start: a new one takes the change and adopts the running engine.
    private fun restartSupervisor(call: PluginCall, said: String) {
        val app = context.applicationContext
        Thread({
            SupervisorHost.restart(app, MainActivity.SUPERVISOR_STOP_MS)
            call.resolve(JSObject().put("said", said).put("count", TrustedCas.count(app)))
        }, "st0-supervisor-restart").start()
    }
}
