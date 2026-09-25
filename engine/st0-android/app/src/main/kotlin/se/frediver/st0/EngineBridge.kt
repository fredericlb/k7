// EngineBridge.kt — the engine in this process: load it, initialise JUCE, and serve on a thread whose
// Looper becomes JUCE's message loop. Once per PROCESS: JUCE stays bound to that Looper, and a quit
// Looper cannot loop again, so a stopped engine is restarted by a new process (docs/android.md).

package se.frediver.st0

import android.content.Context
import android.os.Looper
import android.system.Os
import com.rmsl.juce.Java
import java.io.File

object EngineBridge {
    const val PORT = 8765

    private var thread: Thread? = null

    @JvmStatic private external fun nativeServe(port: Int): Int
    @JvmStatic private external fun nativeQuit()

    /** Start serving, once; `onExit` gets serve()'s exit code, on the engine's thread. */
    fun start(context: Context, onExit: (Int) -> Unit) {
        if (thread != null) return
        // What the supervisor passes on desktop: the state directory, and LAN browsers allowed in.
        Os.setenv("STUDIO_HOME", File(context.filesDir, ".st0").absolutePath, true)
        Os.setenv("STUDIO_ENGINE_HOST", "0.0.0.0", true)
        // Loads libst0engine (Java's static block), whose JNI_OnLoad registered this very method.
        Java.initialiseJUCE(context.applicationContext)
        thread = Thread({
            Looper.prepare()
            onExit(nativeServe(PORT))
        }, "st0-engine").apply { start() }
    }

    /** Ask the engine to stop and wait for it, at most `timeoutMs`; true when it did. */
    fun stop(timeoutMs: Long): Boolean {
        val t = thread ?: return true
        nativeQuit()
        t.join(timeoutMs)
        return !t.isAlive
    }
}
