// EngineBridge.kt — the engine in this process: load it, initialise JUCE, and serve on a thread whose
// Looper becomes JUCE's message loop. The SUPERVISOR decides when, and with which identity, exactly as
// it spawns the engine on desktop. Once per PROCESS: JUCE stays bound to that Looper, and a quit Looper
// cannot loop again, so a stopped engine is restarted by a new process (docs/android.md).

package se.frediver.k7

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
    fun start(context: Context, id: String, token: String, port: Int, host: String, origins: String, onExit: (Int) -> Unit) {
        if (thread != null) {
            Log.w(TAG, "engine already started in this process — a restart needs a new process")
            return
        }
        // What the supervisor's spawn passes on desktop, read by serve() when it starts.
        Os.setenv("STUDIO_HOME", stateDir(context).absolutePath, true)
        Os.setenv("STUDIO_ENGINE_HOST", host, true)
        Os.setenv("STUDIO_ENGINE_ID", id, true)
        Os.setenv("STUDIO_ENGINE_TOKEN", token, true)
        Os.setenv("STUDIO_ENGINE_ALLOWED_ORIGINS", origins, true)
        Os.setenv("STUDIO_FAUST_LIBS", faustLibs(context).absolutePath, true)
        // Loads libk7runtime (Java's static block), whose JNI_OnLoad registered this very method.
        Java.initialiseJUCE(context.applicationContext)
        thread = Thread({
            Looper.prepare()
            onExit(nativeServe(port))
        }, "k7-runtime").apply { start() }
    }

    /** Ask the engine to stop and wait for it, at most `timeoutMs`; true when it did. */
    fun stop(timeoutMs: Long): Boolean {
        val t = synchronized(this) { thread } ?: return true
        nativeQuit()
        t.join(timeoutMs)
        return !t.isAlive
    }

    /** `~/.k7` on a phone: the app's own files, shared by the engine and the supervisor. */
    fun stateDir(context: Context) = File(context.filesDir, ".k7")

    /** Faust's standard libraries, out of the APK's assets and onto disk, where the compiler reads them; redone per install. */
    private fun faustLibs(context: Context): File {
        val dir = File(context.filesDir, FAUST_LIBS)
        val marker = File(dir, ".installed")
        val stamp = context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime.toString()
        if (marker.isFile && marker.readText() == stamp) return dir
        dir.deleteRecursively()
        dir.mkdirs()
        val names = context.assets.list(FAUST_LIBS).orEmpty()
        for (name in names)
            context.assets.open("$FAUST_LIBS/$name").use { from -> File(dir, name).outputStream().use(from::copyTo) }
        // Last, so a copy cut short by a kill is redone on the next start rather than trusted.
        marker.writeText(stamp)
        Log.i(TAG, "unpacked ${names.size} Faust libraries")
        return dir
    }

    private const val TAG = "k7-runtime"
    private const val FAUST_LIBS = "faust-libs"
}
