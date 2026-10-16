// Busy.kt — whether the app is at work, and what that holds: EngineService in the foreground, and the screen on.
// Two sources: the supervisor's snapshot says when a session of the engine PLAYS, whoever drives it; the views say,
// as `busy` messages (StudioBridge), what only a page knows — a track armed, a take rolling, a rig sounding
// (apps/k7/frontend/src/androidBusy.ts), a microphone or a wake lock held (assets/media-session.js).
// A page that never reports is not busy, so nothing here outlives it. See docs/android.md.

package se.frediver.k7

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

object Busy : SupervisorHost.Listener {
    // Each source's reasons, keyed `<view>/<from>`; touched on the main thread only.
    private val reasons = mutableMapOf<String, Set<String>>()
    @Volatile private var enginePlaying = false
    private var app: Context? = null
    private var armedBefore = false
    private val main = Handler(Looper.getMainLooper())

    private val KNOWN = setOf("recording", "armed", "playing", "live", "capture", "awake")
    // What reaches the engine's inputs or the page's microphone, so the service needs the microphone type.
    private val MIC = setOf("recording", "armed", "live", "capture")

    /** Once per process; a later call only re-applies, for an activity Android recreated. */
    fun start(context: Context) {
        if (app == null) {
            app = context.applicationContext
            SupervisorHost.listen(this)
        }
        apply()
    }

    /** True while anything at all is reported: what a restart offered to the user waits for. */
    val busy: Boolean get() = enginePlaying || reasons.isNotEmpty()

    /** One view's `busy` message, on the main thread, where the WebView delivers it. */
    fun report(view: String, msg: JSONObject) {
        val list = msg.optJSONArray("reasons")
        val said = (0 until (list?.length() ?: 0)).map { list!!.optString(it) }.filter { it in KNOWN }.toSet()
        val key = "$view/${msg.optString("from")}"
        if (said.isEmpty()) reasons.remove(key) else reasons[key] = said
        apply()
    }

    override fun onState(frame: JSONObject) {
        val sessions = frame.optJSONArray("sessions")
        val playing = (0 until (sessions?.length() ?: 0)).any { sessions!!.optJSONObject(it)?.optBoolean("playing") == true }
        if (playing == enginePlaying) return
        enginePlaying = playing
        main.post(::apply)
    }

    override fun onEngineExit(code: Int) {
        enginePlaying = false
        main.post(::apply)
    }

    private fun apply() {
        val context = app ?: return
        val all = reasons.values.flatten().toSet()
        val activity = MainActivity.current()
        // The screen stays on for what a person is watching; the engine played from another device leaves it alone.
        activity?.keepScreenOn(all.isNotEmpty())
        if ((all - "awake").isNotEmpty() || enginePlaying) {
            val mic = all.any { it in MIC } &&
                context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            EngineService.hold(context, label(all), mic)
            activity?.askNotifications()
        } else {
            EngineService.release(context)
        }
        // A track armed is the engine asked for its inputs: the moment to ask for the microphone, if nobody has.
        val armed = "armed" in all
        if (armed && !armedBefore) activity?.mic?.request { }
        armedBefore = armed
    }

    private fun label(all: Set<String>) = when {
        "recording" in all || "capture" in all -> "Recording"
        "armed" in all || "live" in all -> "Inputs live"
        else -> "Playing"
    }
}
