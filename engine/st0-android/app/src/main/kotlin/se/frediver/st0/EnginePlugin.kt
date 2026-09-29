// EnginePlugin.kt — the shell page's way to the supervisor (web/src/native.ts, St0Engine): its snapshots
// as `state` events, the engine's exit as `engineExit`, and the few commands the tray sends. st0's
// settings panel reaches the same through StudioBridge.kt; what both do beyond a command is EngineOps.kt.

package se.frediver.st0

import android.content.Intent
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

@CapacitorPlugin(name = "St0Engine")
class EnginePlugin : Plugin(), SupervisorHost.Listener {
    override fun load() = SupervisorHost.listen(this)

    override fun handleOnDestroy() = SupervisorHost.unlisten(this)

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

    @PluginMethod
    fun lanAddress(call: PluginCall) =
        call.resolve(JSObject().apply { EngineOps.lanAddress(context)?.let { put("address", it) } })

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
        EngineOps.importCa(context, uri) { settle(call, it) }
    }

    @PluginMethod
    fun forgetCas(call: PluginCall) = EngineOps.forgetCas(context) { settle(call, it) }

    @PluginMethod
    fun quit(call: PluginCall) {
        call.resolve()
        activity.runOnUiThread { activity.finish() }
    }

    private fun settle(call: PluginCall, done: Result<JSONObject>) =
        done.fold({ call.resolve(JSObject(it.toString())) }, { call.reject(it.message) })
}
