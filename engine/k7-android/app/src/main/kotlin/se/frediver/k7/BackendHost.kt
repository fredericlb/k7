// BackendHost.kt — k7's own backend on the phone, so the app is standalone like the desktop one: the
// bundle the packaged desktop app runs too (apps/k7/backend/scripts/bundle.mjs) under Termux's node
// (scripts/termux-tools.mjs), with the file services it starts. Port, environment
// and folders are the desktop's, from apps/k7/backend/standalone.json. The tools are lib*.so files run
// from the native library directory; every name a program looks up is a symlink to one. See docs/android.md.

package se.frediver.k7

import android.content.Context
import android.system.Os
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.zip.ZipInputStream

/** One per PROCESS, like the supervisor: the backend outlives a recreated activity. */
object BackendHost {
    /** standalone.json's port, the desktop app's: its OIDC client's redirect is registered on it. */
    const val PORT = BuildConfig.STANDALONE_PORT
    const val ORIGIN = "http://127.0.0.1:$PORT"
    /** What every process that derives a loopback address is told — the backend, its file services, the supervisor, the pages. */
    const val PORTS_SPEC = "k7=$PORT"
    /** Where a signed-out view lands: the local user, unless a session is already there. */
    const val LOCAL_HOME = "$ORIGIN/auth/local?return_to=%2F"

    /** Where the start is: `starting` with a step and maybe a fraction done, `ready`, or `failed` with why. */
    data class Status(val state: String, val step: String? = null, val progress: Double? = null, val message: String? = null)

    private var process: Process? = null
    private var started = false
    private var stopping = false
    // Bumped by every retry, so the waiter of an older launch never relaunches over a newer one.
    private var generation = 0
    private var status = Status("starting")
    private val waiting = mutableListOf<(String?) -> Unit>()
    private val watchers = mutableListOf<(Status) -> Unit>()

    /** Unpack, lay out and start, once per process: a first run unpacks for a few seconds. */
    @Synchronized
    fun start(context: Context) {
        if (started) return
        started = true
        val app = context.applicationContext
        val gen = generation
        Thread({
            try {
                report(Status("starting"))
                val dirs = prepare(app)
                report(Status("starting", "launching"))
                launch(app, dirs, gen)
                waitUp()
                Log.i(TAG, "backend up on $ORIGIN")
                settle(Status("ready"), null)
            } catch (e: Exception) {
                Log.e(TAG, "backend did not start: ${e.message}", e)
                val why = e.message ?: e.javaClass.simpleName
                settle(Status("failed", message = why), why)
            }
        }, "k7-backend-start").start()
    }

    /** After a failed start: stop whatever half-started, then start again from the unpack. */
    fun retry(context: Context) {
        val p = synchronized(this) {
            if (status.state != "failed") return
            generation++
            stopping = true
            process
        }
        if (p != null) {
            p.destroy()
            if (!p.waitFor(RETRY_STOP_MS, java.util.concurrent.TimeUnit.MILLISECONDS)) p.destroyForcibly()
        }
        synchronized(this) {
            process = null
            stopping = false
            started = false
            status = Status("starting")
        }
        start(context)
    }

    /** `then` once the backend has answered (null) or failed to (why) — at once if known — on whichever thread saw it. */
    fun whenReady(then: (String?) -> Unit) {
        val now = synchronized(this) { status.also { if (it.state == "starting") waiting.add(then) } }
        if (now.state != "starting") then(now.message.takeIf { now.state == "failed" })
    }

    fun current(): Status = synchronized(this) { status }

    /** Every status change from now on, called on whichever thread made it. */
    fun watch(watcher: (Status) -> Unit) {
        synchronized(this) { watchers.add(watcher) }
    }

    fun unwatch(watcher: (Status) -> Unit) {
        synchronized(this) { watchers.remove(watcher) }
    }

    private fun report(next: Status) {
        val to = synchronized(this) {
            status = next
            watchers.toList()
        }
        to.forEach { it(next) }
    }

    private fun settle(next: Status, error: String?) {
        report(next)
        val run = synchronized(this) { waiting.toList().also { waiting.clear() } }
        run.forEach { it(error) }
    }

    /** SIGTERM, which the backend answers by stopping its file services; killed after `timeoutMs`. */
    fun stop(timeoutMs: Long) {
        val p = synchronized(this) {
            stopping = true
            process
        } ?: return
        p.destroy()
        if (!p.waitFor(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)) p.destroyForcibly()
    }

    private class Dirs(val root: File, val bundle: File, val tools: File, val cacert: File, val table: JSONObject)

    private fun prepare(context: Context): Dirs {
        val root = File(context.filesDir, "standalone")
        val bundle = unpack(context, File(root, "backend"))
        val tools = layOutTools(context, File(root, "tools"))
        val cacert = File(bundle, "cacert.pem")
        File(root, "home").mkdirs()
        val table = JSONObject(File(bundle, TABLE).readText())
        return Dirs(root, bundle, tools, cacert, table)
    }

    /** The bundle, out of the APK's assets and onto disk, where node reads it; redone per install. */
    private fun unpack(context: Context, dir: File): File {
        val marker = File(dir, ".installed")
        val stamp = context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime.toString()
        if (marker.isFile && marker.readText() == stamp) return dir
        dir.deleteRecursively()
        dir.mkdirs()
        var count = 0
        // Stored uncompressed in the APK (noCompress), so its length is known and the bytes read are the progress.
        val total = context.assets.openFd(BUNDLE_ASSET).use { it.length }.coerceAtLeast(1)
        ZipInputStream(Counting(context.assets.open(BUNDLE_ASSET), total).buffered()).use { zip ->
            generateSequence { zip.nextEntry }.forEach { entry ->
                val out = File(dir, entry.name)
                require(out.canonicalPath.startsWith(dir.canonicalPath + File.separator)) { "bad entry ${entry.name}" }
                if (entry.isDirectory) out.mkdirs()
                else {
                    out.parentFile?.mkdirs()
                    out.outputStream().use(zip::copyTo)
                    count++
                }
            }
        }
        // The CA bundle and the versions travel as their own assets, beside the zip.
        for (name in listOf("cacert.pem", "termux-versions.json"))
            context.assets.open("$TOOLS_ASSETS/$name").use { from -> File(dir, name).outputStream().use(from::copyTo) }
        // Last, so an unpack cut short by a kill is redone on the next start rather than trusted.
        marker.writeText(stamp)
        Log.i(TAG, "unpacked the backend: $count files")
        return dir
    }

    /** The asset as it is read, reporting each whole percent of it to the watchers. */
    private class Counting(inner: java.io.InputStream, private val total: Long) : java.io.FilterInputStream(inner) {
        private var done = 0L
        private var shown = -1

        private fun add(n: Int) {
            if (n <= 0) return
            done += n
            val pct = (done * 100 / total).toInt()
            if (pct == shown) return
            shown = pct
            report(Status("starting", "unpacking", pct / 100.0))
        }

        override fun read(): Int = super.read().also { if (it >= 0) add(1) }

        override fun read(b: ByteArray, off: Int, len: Int): Int = super.read(b, off, len).also(::add)
    }

    /** `bin/` of symlinks into the native library directory, which moves on every update, so redone each start. */
    private fun layOutTools(context: Context, dir: File): File {
        val lib = context.applicationInfo.nativeLibraryDir
        dir.deleteRecursively()
        val links = mapOf(
            "bin/node" to "libk7node.so",
        )
        for ((name, target) in links) {
            val at = File(dir, name)
            at.parentFile?.mkdirs()
            Os.symlink("$lib/$target", at.absolutePath)
        }
        return dir
    }

    /** Generated once and kept, so a session survives a restart. */
    private fun sessionSecret(root: File): String {
        val file = File(root, "session-secret")
        if (file.isFile) return file.readText()
        val secret = ByteArray(32).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        file.writeText(secret)
        return secret
    }

    @Synchronized
    private fun launch(context: Context, dirs: Dirs, gen: Int) {
        val lib = context.applicationInfo.nativeLibraryDir
        val tools = dirs.tools.absolutePath
        val cacert = dirs.cacert.absolutePath
        val p = ProcessBuilder("$lib/libk7node.so", File(dirs.bundle, "bin/backend.mjs").absolutePath).apply {
            directory(dirs.root)
            redirectErrorStream(true)
            environment().apply {
                put("LD_LIBRARY_PATH", lib)
                put("PATH", "$tools/bin:/system/bin")
                put("HOME", File(dirs.root, "home").absolutePath)
                put("TMPDIR", context.cacheDir.absolutePath)
                put("NODE_OPTIONS", "--experimental-sqlite")
                put("SSL_CERT_FILE", cacert)
                TrustedCas.file(context).takeIf { it.isFile }?.let { put("NODE_EXTRA_CA_CERTS", it.absolutePath) }
                put("PORT", PORT.toString())
                put("STUDIO_PORTS", PORTS_SPEC)
                put("SESSION_SECRET", sessionSecret(dirs.root))
                // The desktop's table: the public OIDC client, the local user, a host-only cookie.
                val env = dirs.table.getJSONObject("env")
                env.keys().forEach { put(it, env.getString(it)) }
                val folders = dirs.table.getJSONObject("dirs")
                folders.keys().forEach { put(it, File(dirs.root, folders.getString(it)).absolutePath) }
                put("STUDIO_FILE_SERVICE_ENTRY", File(dirs.bundle, "bin/file-service.mjs").absolutePath)
                // The hub copies `k7` from the bundle the first time it has no folder for it.
                put("STUDIO_LIBRARY_SEED", "k7-core=" + File(dirs.bundle, dirs.table.getString("library")).absolutePath)
            }
        }.start()
        process = p
        Thread({ p.inputStream.bufferedReader().forEachLine { Log.i(TAG, it) } }, "k7-backend-out").start()
        Thread({
            val code = p.waitFor()
            val again = synchronized(this) {
                if (gen != generation) return@Thread
                process = null
                !stopping
            }
            Log.w(TAG, "backend exited ($code)")
            // A crash leaves the views on a dead origin: one relaunch after a pause, never in a tight loop.
            if (again) {
                Thread.sleep(RELAUNCH_MS)
                synchronized(this) { if (!stopping && gen == generation && process == null) launch(context, dirs, gen) }
            }
        }, "k7-backend-wait").start()
    }

    /** Until the backend answers its registry's hello — what the supervisor asks before it connects. */
    private fun waitUp() {
        val end = System.currentTimeMillis() + READY_MS
        while (System.currentTimeMillis() < end) {
            try {
                val c = URL("$ORIGIN/api/registry/hello").openConnection() as HttpURLConnection
                c.connectTimeout = 500
                c.readTimeout = 500
                if (c.responseCode == 200) return
            } catch (_: java.io.IOException) {
                // not listening yet
            }
            Thread.sleep(200)
        }
        throw IllegalStateException("no answer on $ORIGIN within $READY_MS ms")
    }

    private const val TAG = "k7-backend"
    private const val BUNDLE_ASSET = "backend.zip"
    private const val TABLE = "standalone.json"
    private const val TOOLS_ASSETS = "termux"
    private const val READY_MS = 60_000L
    private const val RELAUNCH_MS = 2_000L
    private const val RETRY_STOP_MS = 3_000L
}
