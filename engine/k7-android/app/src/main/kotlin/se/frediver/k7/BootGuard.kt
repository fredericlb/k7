// BootGuard.kt — a build that crashes in its first seconds must still reach the update that fixes it. Each start of
// the engine counts one more quick start, on disk at once; a run that lives HEALTHY_MS, or a quit, sets the count back
// to zero. After MAX_QUICK_STARTS in a row the engine, where a native crash most likely comes from, is left off for
// that run, and the person is offered the update or the engine anyway. See docs/android.md.

package se.frediver.k7

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.appcompat.app.AlertDialog

object BootGuard {
    private const val TAG = "k7-boot"
    private const val PREFS = "k7-boot"
    private const val KEY = "quickStarts"
    private const val HEALTHY_MS = 30_000L
    private const val MAX_QUICK_STARTS = 3
    private var entered = false
    private var skipped = false
    private var offered = false
    private val main = Handler(Looper.getMainLooper())

    /** Once per process, before the engine starts: true when it is to be left off this run. */
    @Synchronized
    fun enter(context: Context): Boolean {
        if (entered) return skipped
        entered = true
        skipped = prefs(context).getInt(KEY, 0) >= MAX_QUICK_STARTS
        if (skipped) {
            Log.w(TAG, "$MAX_QUICK_STARTS quick crashes in a row: the engine is left off")
            clean(context)
        } else starting(context)
        return skipped
    }

    /** One more start that may crash: counted now, forgotten once it has lived HEALTHY_MS. */
    fun starting(context: Context) {
        val app = context.applicationContext
        // commit, not apply: a crash a moment later must find it on disk.
        prefs(app).edit().putInt(KEY, prefs(app).getInt(KEY, 0) + 1).commit()
        main.postDelayed({ clean(app) }, HEALTHY_MS)
    }

    /** A run that lived, or a quit: no crash at boot. */
    fun clean(context: Context) {
        prefs(context).edit().putInt(KEY, 0).commit()
    }

    /** The run without its engine, said: the update, which may fix it, or the engine anyway. */
    fun offer(activity: MainActivity) {
        // Once per process: an activity made again does not ask twice.
        if (offered) return
        offered = true
        AlertDialog.Builder(activity)
            .setTitle("k7")
            .setMessage("k7 stopped right after starting $MAX_QUICK_STARTS times in a row, so its engine is off this time. An update may fix it.")
            .setPositiveButton("Check for updates") { _, _ -> Updates.checkNow(activity) }
            .setNeutralButton("Start the engine") { _, _ ->
                starting(activity)
                SupervisorHost.start(activity)
            }
            .setNegativeButton("Not now", null)
            .show()
    }

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
