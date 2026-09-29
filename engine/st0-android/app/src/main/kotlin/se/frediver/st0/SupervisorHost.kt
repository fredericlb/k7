// SupervisorHost.kt — the app's half of the supervisor's NDJSON channel: what engine/st0-tray's host.rs
// is on desktop. It runs st0-supervisor from the native library directory, the one place Android lets an
// app execute its own binary, and adds the one Android duty: the supervisor's `engine` requests, since
// the engine is a library in THIS process rather than a program it could spawn. See docs/android.md.

package se.frediver.st0

import android.content.Context
import android.os.Build
import android.provider.Settings
import android.util.Log
import org.json.JSONObject
import java.io.BufferedWriter
import java.io.File
import java.util.concurrent.TimeUnit

/** One per PROCESS, like the engine: Android recreates activities on its own, and a second supervisor is refused. */
object SupervisorHost {
    /** What a page draws: the latest snapshot, and the engine's exit code once it stopped. */
    interface Listener {
        fun onState(frame: JSONObject)
        fun onEngineExit(code: Int)
    }

    private var process: Process? = null
    private var stdin: BufferedWriter? = null
    private var nextId = 1
    // The shell page's plugin and st0's settings panel (StudioBridge) both watch.
    private val listeners = java.util.concurrent.CopyOnWriteArraySet<Listener>()
    private var lastState: JSONObject? = null
    private var engineExit: Int? = null
    private var restarting = false

    /** Start once per process; a later call only keeps the app context. */
    @Synchronized
    fun start(context: Context) {
        if (process != null) return
        val app = context.applicationContext
        // Packaged as a lib*.so so the installer extracts it, executable, beside the engine's library.
        val binary = File(app.applicationInfo.nativeLibraryDir, "libst0supervisor.so")
        val p = ProcessBuilder(binary.absolutePath).apply {
            environment()["STUDIO_HOME"] = EngineBridge.stateDir(app).absolutePath
            environment()["STUDIO_MACHINE_NAME"] = deviceName(app)
            TrustedCas.file(app).takeIf { it.isFile }?.let { environment()["STUDIO_EXTRA_CA_CERTS"] = it.absolutePath }
        }.start()
        process = p
        stdin = p.outputStream.bufferedWriter()
        Thread({ p.inputStream.bufferedReader().forEachLine { onFrame(app, p, it) } }, "st0-supervisor-out").start()
        Thread({ p.errorStream.bufferedReader().forEachLine { Log.i(TAG, it) } }, "st0-supervisor-err").start()
    }

    /** One more watcher, told at once what is already known. */
    fun listen(l: Listener) {
        val (state, exit) = synchronized(this) {
            listeners.add(l)
            lastState to engineExit
        }
        state?.let(l::onState)
        exit?.let(l::onEngineExit)
    }

    fun unlisten(l: Listener) {
        listeners.remove(l)
    }

    /** What is already known, for a page that asks before it listens: the latest snapshot and the engine's exit code. */
    @Synchronized
    fun known(): Pair<JSONObject?, Int?> = lastState to engineExit

    /** One command, as the tray sends it: `arg` is always one string. */
    @Synchronized
    fun command(cmd: String, arg: String = "") {
        val w = stdin ?: return
        val line = JSONObject().put("t", "cmd").put("id", nextId++).put("cmd", cmd).put("arg", arg)
        try {
            w.write(line.toString())
            w.newLine()
            w.flush()
        } catch (e: java.io.IOException) {
            Log.w(TAG, "supervisor gone: ${e.message}")
        }
    }

    /** A new supervisor for what only its start reads — the trusted CAs; the engine keeps serving, and the new one adopts it. */
    fun restart(context: Context, timeoutMs: Long) {
        synchronized(this) { restarting = true }
        stop(timeoutMs)
        synchronized(this) {
            process = null
            restarting = false
        }
        start(context)
    }

    /** Close stdin, which IS the supervisor's quit: it deregisters, asks the engine to stop, and exits. */
    fun stop(timeoutMs: Long) {
        val p = synchronized(this) {
            runCatching { stdin?.close() }
            stdin = null
            process
        } ?: return
        if (!p.waitFor(timeoutMs, TimeUnit.MILLISECONDS)) p.destroyForcibly()
    }

    private fun onFrame(context: Context, from: Process, line: String) {
        val frame = runCatching { JSONObject(line) }.getOrNull() ?: return
        when (frame.optString("t")) {
            "state" -> {
                synchronized(this) { lastState = frame }
                listeners.forEach { it.onState(frame) }
            }
            // Only the CURRENT supervisor's: a restarted one's last words — "stop the engine" — may still be in its pipe.
            "engine" -> if (synchronized(this) { from == process && !restarting }) onEngine(context, frame)
            "result" -> if (!frame.optBoolean("ok", true)) Log.w(TAG, "command ${frame.optInt("id")}: ${frame.optString("message")}")
        }
    }

    private fun onEngine(context: Context, frame: JSONObject) {
        when (frame.optString("action")) {
            "start" -> EngineBridge.start(
                context,
                frame.getString("id"),
                frame.getString("token"),
                frame.getInt("port"),
                frame.optString("host", "0.0.0.0"),
            ) { code ->
                synchronized(this) { engineExit = code }
                listeners.forEach { it.onEngineExit(code) }
            }
            // Off this reader thread: the join would hold up every frame behind it.
            "stop" -> Thread({ EngineBridge.stop(ENGINE_STOP_MS) }, "st0-engine-stop").start()
        }
    }

    // What the picker shows for this engine: the name the user gave the phone, else its model.
    private fun deviceName(context: Context): String =
        Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME) ?: Build.MODEL

    private const val TAG = "st0-supervisor"
    private const val ENGINE_STOP_MS = 3000L
}
