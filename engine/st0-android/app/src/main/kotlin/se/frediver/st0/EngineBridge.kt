// EngineBridge.kt — the engine in this process: load it, initialise JUCE, and serve on a thread whose
// Looper becomes JUCE's message loop. The SUPERVISOR decides when, and with which identity, exactly as
// it spawns the engine on desktop. Once per PROCESS: JUCE stays bound to that Looper, and a quit Looper
// cannot loop again, so a stopped engine is restarted by a new process (docs/android.md).

package se.frediver.st0

import android.content.Context
import android.os.Looper
import android.system.Os
import android.util.Log
import com.rmsl.juce.Java
import java.io.File

object EngineBridge {
    private var thread: Thread? = null

    @JvmStatic private external fun nativeServe(port: Int): Int
    @JvmStatic private external fun nativeQuit()

    /** Serve with the supervisor's identity, once; `onExit` gets serve()'s exit code, on the engine's thread. */
    @Synchronized
    fun start(context: Context, id: String, token: String, port: Int, host: String, onExit: (Int) -> Unit) {
        if (thread != null) {
            Log.w(TAG, "engine already started in this process — a restart needs a new process")
            return
        }
        // What the supervisor's spawn passes on desktop, read by serve() when it starts.
        Os.setenv("STUDIO_HOME", stateDir(context).absolutePath, true)
        Os.setenv("STUDIO_ENGINE_HOST", host, true)
        Os.setenv("STUDIO_ENGINE_ID", id, true)
        Os.setenv("STUDIO_ENGINE_TOKEN", token, true)
        // Loads libst0engine (Java's static block), whose JNI_OnLoad registered this very method.
        Java.initialiseJUCE(context.applicationContext)
        thread = Thread({
            Looper.prepare()
            onExit(nativeServe(port))
        }, "st0-engine").apply { start() }
    }

    /** Ask the engine to stop and wait for it, at most `timeoutMs`; true when it did. */
    fun stop(timeoutMs: Long): Boolean {
        val t = synchronized(this) { thread } ?: return true
        nativeQuit()
        t.join(timeoutMs)
        return !t.isAlive
    }

    /** `~/.st0` on a phone: the app's own files, shared by the engine and the supervisor. */
    fun stateDir(context: Context) = File(context.filesDir, ".st0")

    private const val TAG = "st0-engine"
}
