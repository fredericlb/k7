// Relaunch.kt — k7 opened again in a NEW process: the engine starts once per process (EngineBridge), and a quit ends
// with exitProcess, which would kill an activity opened in the old process meanwhile. A small activity in a process
// of its own (`:relaunch`) waits for the old one to be gone, then opens MainActivity. It is started while k7 is in
// front, the only time Android lets an app open an activity. See docs/android.md.

package se.frediver.k7

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.appcompat.app.AlertDialog
import androidx.lifecycle.Lifecycle
import java.io.File
import kotlin.concurrent.thread
import kotlin.system.exitProcess

object Relaunch {
    internal const val PID = "pid"
    private const val TAG = "k7-relaunch"
    private val main = Handler(Looper.getMainLooper())
    // What was offered already in this process, by key: a "Later" is not asked again.
    private val offered = mutableSetOf<String>()

    /** Quit, then open again: the relaunch waits for this process's teardown to end. */
    fun restart(activity: Activity) {
        after(activity)
        activity.finish()
    }

    /** MainActivity again once this process is gone; `activity` must be the one in front. */
    fun after(activity: Activity) {
        val intent = Intent(activity, RelaunchActivity::class.java)
            .putExtra(PID, android.os.Process.myPid())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { activity.startActivity(intent) }.onFailure { Log.w(TAG, "no relaunch: ${it.message}") }
    }

    /** `message` and a Restart k7 button, once per `key` and process, when k7 is in front; not shown otherwise. */
    fun offer(key: String, message: String) {
        main.post {
            val activity = MainActivity.current() ?: return@post
            if (key in offered || !activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) return@post
            offered.add(key)
            AlertDialog.Builder(activity)
                .setTitle("k7")
                .setMessage(message)
                .setPositiveButton("Restart k7") { _, _ -> restart(activity) }
                .setNegativeButton("Later", null)
                .show()
        }
    }
}

/** The splash, shown while the old process ends; then MainActivity, and this process ends too. */
class RelaunchActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pid = intent.getIntExtra(Relaunch.PID, 0)
        thread(name = "k7-relaunch") {
            // Longer than MainActivity's teardown, whose stops add up to about 14 s.
            val end = SystemClock.elapsedRealtime() + WAIT_MS
            while (pid > 0 && File("/proc/$pid").exists() && SystemClock.elapsedRealtime() < end) Thread.sleep(POLL_MS)
            runOnUiThread {
                startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
                finish()
                exitProcess(0)
            }
        }
    }

    private companion object {
        const val WAIT_MS = 20_000L
        const val POLL_MS = 100L
    }
}
