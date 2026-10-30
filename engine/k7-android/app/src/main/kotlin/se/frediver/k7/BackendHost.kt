// BackendHost.kt — k7's own backend on the phone, so the app is standalone like the desktop one: the
// bundle the packaged desktop app runs too (apps/k7/backend/scripts/bundle.mjs) under Termux's node
// (scripts/termux-tools.mjs), with the file services it starts. Port, environment
// and folders are the desktop's, from apps/k7/backend/standalone.json. The tools are lib*.so files run
// from the native library directory; every name a program looks up is a symlink to one. See docs/android.md.

package se.frediver.k7

import android.content.Context
import android.os.SystemClock
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
    // The session cookie apps/k7/backend/src/server.ts names.
    private const val SESSION_COOKIE = "studio.sid"

    /** k7's first page: `/` straight away when the WebView holds a session, else through the local sign-in; a stale one is caught by account.js. */
    fun home(): String {
        val cookies = android.webkit.CookieManager.getInstance().getCookie(ORIGIN)
        return if (cookies?.split(';')?.any { it.trim().startsWith("$SESSION_COOKIE=") } == true) "$ORIGIN/" else LOCAL_HOME
    }

    private var process: Process? = null
    private var app: Context? = null
    private var dirs: Dirs? = null
    private var started = false
    private var stopping = false
    private var ready = false
    // Why the backend is given up on, until a view asks again; null while it runs or is being relaunched.
    private var failure: String? = null
    private var quickExits = 0
    // Exits by SIGKILL, counted apart: Android's phantom process killer is no crash at boot (docs/android.md).
    private var killedExits = 0
    // Opened by the running backend's READY_LINE on its stdout.
    private var up: Pair<Process, java.util.concurrent.CountDownLatch>? = null
    private val waiting = mutableListOf<Waiter>()
    private var status = Status("starting")
    private val watchers = mutableListOf<(Status) -> Unit>()

    private class Waiter(val then: () -> Unit, val failed: (String) -> Unit)

    /** What the shell page shows: `starting` with a step (`unpacking` with the fraction done, `launching`), `ready`, or `failed` with why. */
    data class Status(val state: String, val step: String? = null, val progress: Double? = null, val message: String? = null)

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

    /** Unpack, lay out and start, once per process: a first run unpacks for a few seconds. */
    @Synchronized
    fun start(context: Context) {
        if (started) return
        started = true
        app = context.applicationContext
        attempt()
    }

    /** `then` once the backend has answered — at once if it has — or `failed` once it is given up on; either on any thread. */
    fun whenReady(then: () -> Unit, failed: (String) -> Unit) {
        val now = synchronized(this) { ready.also { if (!it) waiting.add(Waiter(then, failed)) } }
        // A view asking after the backend was given up on is the user's retry.
        if (now) then() else retry()
    }

    /** The user's retry — a view asking again, or the shell page's Retry: a backend given up on starts over, with a fresh count of quick exits. */
    fun retry() {
        val again = synchronized(this) {
            (failure != null && started).also {
                if (it) {
                    failure = null
                    quickExits = 0
                    killedExits = 0
                }
            }
        }
        if (again) attempt()
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

    /** Launch unless one runs, then wait for its answer; a launch that exits first is left to its waiter thread. */
    private fun attempt() {
        val context = synchronized(this) { app } ?: return
        Thread(body@{
            var launched: Process? = null
            try {
                report(Status("starting"))
                val d = synchronized(this) { dirs } ?: prepare(context).also { synchronized(this) { dirs = it } }
                report(Status("starting", "launching"))
                val p = synchronized(this) { if (stopping) null else process ?: launch(context, d) } ?: return@body
                launched = p
                if (!waitUp(p)) return@body
                Log.i(TAG, "backend up on $ORIGIN")
                report(Status("ready"))
                val run = synchronized(this) {
                    ready = true
                    waiting.toList().also { waiting.clear() }
                }
                run.forEach { it.then() }
                Thread({ probe(p) }, "k7-backend-health").start()
            } catch (e: Exception) {
                Log.e(TAG, "backend did not start: ${e.message}", e)
                fail(e.message ?: "k7's backend did not start")
                // Given up on, it goes: a Retry must launch afresh, not wait on the same wedged process.
                launched?.let(::discard)
            }
        }, "k7-backend-start").start()
    }

    /** Killed, and no longer the one running, so nothing reuses it; its waiter thread sees the exit. */
    private fun discard(p: Process) {
        synchronized(this) {
            if (process === p) {
                process = null
                ready = false
            }
        }
        p.destroyForcibly()
    }

    /** Health every PROBE_EVERY_MS once up: a backend that stops answering PROBE_MISSES times in a row is killed, and relaunched by watch. */
    private fun probe(p: Process) {
        var misses = 0
        while (true) {
            Thread.sleep(PROBE_EVERY_MS)
            if (!p.isAlive || synchronized(this) { stopping || process !== p }) return
            misses = if (answers("/api/health", PROBE_TIMEOUT_MS)) 0 else misses + 1
            if (misses < PROBE_MISSES) continue
            Log.w(TAG, "backend stopped answering; killed, to be relaunched")
            return discard(p)
        }
    }

    /** Whether `path` answers 200 within `timeoutMs`. */
    private fun answers(path: String, timeoutMs: Int): Boolean = try {
        val c = URL("$ORIGIN$path").openConnection() as HttpURLConnection
        c.connectTimeout = timeoutMs
        c.readTimeout = timeoutMs
        try {
            c.responseCode == 200
        } finally {
            c.disconnect()
        }
    } catch (_: java.io.IOException) {
        false
    }

    /** Given up on: every view waiting is told why, and the next one to ask starts it again. */
    private fun fail(why: String) {
        val told = synchronized(this) {
            if (stopping) return
            failure = why
            ready = false
            waiting.toList().also { waiting.clear() }
        }
        report(Status("failed", message = why))
        told.forEach { it.failed(why) }
    }

    /** Where the backend keeps everything it writes, beside the engine's `.k7`. */
    private fun rootDir(context: Context) = File(context.filesDir, "standalone")

    /** The backend's workspaces and médiathèque, which the engine must be allowed to open (engine/k7-runtime/docs/android.md). */
    fun engineRoots(context: Context): List<File> =
        BuildConfig.ENGINE_ROOT_DIRS.split(';').filter { it.isNotEmpty() }.map { File(rootDir(context), it) }

    private class Dirs(val root: File, val bundle: File, val tools: File, val cacert: File, val table: JSONObject)

    private fun prepare(context: Context): Dirs {
        val root = rootDir(context)
        val bundle = unpack(context, File(root, "backend"))
        val tools = layOutTools(context, File(root, "tools"))
        val cacert = File(bundle, "cacert.pem")
        File(root, "home").mkdirs()
        val table = JSONObject(File(bundle, TABLE).readText())
        return Dirs(root, bundle, tools, cacert, table)
    }

    /** The bundle, out of the APK's assets and onto disk, where node reads it; per install, writing only the files that changed. */
    private fun unpack(context: Context, dir: File): File {
        val marker = File(dir, ".installed")
        val stamp = context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime.toString()
        if (marker.isFile && marker.readText() == stamp) return dir
        // First, so an unpack cut short by a kill is redone on the next start rather than trusted.
        marker.delete()
        dir.mkdirs()
        val manifest = File(dir, ENTRIES)
        val before = runCatching { manifest.readLines() }.getOrDefault(emptyList()).mapNotNull { line ->
            line.split('\t').takeIf { it.size == 2 }?.let { it[0] to it[1] }
        }.toMap()
        val after = mutableMapOf<String, String>()
        val names = mutableSetOf<String>()
        var count = 0
        // Stored uncompressed in the APK (noCompress), so its length is known and the bytes read are the progress.
        val total = context.assets.openFd(BUNDLE_ASSET).use { it.length }.coerceAtLeast(1)
        ZipInputStream(Counting(context.assets.open(BUNDLE_ASSET), total).buffered()).use { zip ->
            generateSequence { zip.nextEntry }.forEach { entry ->
                val out = File(dir, entry.name)
                require(out.canonicalPath.startsWith(dir.canonicalPath + File.separator)) { "bad entry ${entry.name}" }
                names.add(entry.name.trimEnd('/'))
                if (entry.isDirectory) out.mkdirs()
                else {
                    // The local header's CRC and size, which Gradle's Zip writes; an entry without them is always written.
                    val key = if (entry.crc != -1L && entry.size >= 0) "${entry.crc}:${entry.size}" else null
                    key?.let { after[entry.name] = it }
                    if (key == null || before[entry.name] != key || out.length() != entry.size) {
                        out.parentFile?.mkdirs()
                        out.outputStream().use(zip::copyTo)
                        count++
                    }
                }
            }
        }
        // What the old bundle had and this one does not.
        dir.walkBottomUp().filter { it != dir }.forEach { f ->
            val name = f.relativeTo(dir).invariantSeparatorsPath
            if (name !in names && name !in OWN_FILES && (f.isFile || f.list()?.isEmpty() == true)) f.delete()
        }
        // The CA bundle and the versions travel as their own assets, beside the zip.
        for (name in listOf("cacert.pem", "termux-versions.json"))
            context.assets.open("$TOOLS_ASSETS/$name").use { from -> File(dir, name).outputStream().use(from::copyTo) }
        manifest.writeText(after.entries.joinToString("") { (name, key) -> "$name\t$key\n" })
        marker.writeText(stamp)
        Log.i(TAG, "unpacked the backend: $count files written of ${after.size}")
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
    private fun launch(context: Context, dirs: Dirs): Process {
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
                // node's bytecode of the bundle, kept between launches: only the first after an update parses it (docs/android.md).
                put("NODE_COMPILE_CACHE", File(context.cacheDir, "node-compile-cache").absolutePath)
                put("SSL_CERT_FILE", cacert)
                TrustedCas.file(context).takeIf { it.isFile }?.let { put("NODE_EXTRA_CA_CERTS", it.absolutePath) }
                put("PORT", PORT.toString())
                put("STUDIO_PORTS", PORTS_SPEC)
                // Printed once it listens: the wait below wakes on it rather than polling.
                put("STUDIO_READY_LINE", READY_LINE)
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
        val listening = java.util.concurrent.CountDownLatch(1)
        up = p to listening
        val since = SystemClock.elapsedRealtime()
        Thread({
            p.inputStream.bufferedReader().forEachLine {
                if (it == READY_LINE) listening.countDown() else Log.i(TAG, it)
            }
        }, "k7-backend-out").start()
        Thread({ watch(p, since) }, "k7-backend-wait").start()
        return p
    }

    /** A crash is relaunched on a doubling delay; after MAX_QUICK_EXITS short runs in a row it is given up on (docs/android.md). */
    private fun watch(p: Process, since: Long) {
        val code = p.waitFor()
        // A SIGKILL from outside — Android's phantom process killer, the low-memory killer — is no crash of the backend's.
        val killed = code == KILLED_EXIT
        Log.w(TAG, "backend exited ($code)" + if (killed) ", killed by the system" else "")
        val delay = synchronized(this) {
            if (process === p) process = null
            ready = false
            if (stopping || failure != null) return
            if (SystemClock.elapsedRealtime() - since >= HEALTHY_MS) {
                quickExits = 0
                killedExits = 0
            }
            val n = if (killed) ++killedExits else ++quickExits
            if (n < (if (killed) MAX_KILLED_EXITS else MAX_QUICK_EXITS)) minOf(RELAUNCH_FIRST_MS shl (n - 1), RELAUNCH_MAX_MS) else null
        }
        if (delay == null) {
            val times = if (killed) "was killed $MAX_KILLED_EXITS" else "stopped $MAX_QUICK_EXITS"
            return fail("k7's backend $times times in a row (last exit code $code)")
        }
        report(Status("starting", "launching"))
        Thread.sleep(delay)
        val again = synchronized(this) { !stopping && failure == null && process == null }
        if (again) attempt()
    }

    /** Until the backend answers its registry's hello — what the supervisor asks before it connects; false if `p` exits first. */
    private fun waitUp(p: Process): Boolean {
        val listening = synchronized(this) { up?.takeIf { it.first === p }?.second }
        val end = System.currentTimeMillis() + READY_MS
        while (System.currentTimeMillis() < end) {
            if (!p.isAlive) return false
            if (answers("/api/registry/hello", 500)) return true
            // Woken by the backend's READY_LINE; a bundle that never prints it is still found, by a slower poll.
            if (listening != null && listening.count > 0) listening.await(POLL_MS, java.util.concurrent.TimeUnit.MILLISECONDS)
            else Thread.sleep(RETRY_MS)
        }
        throw IllegalStateException("no answer on $ORIGIN within $READY_MS ms")
    }

    private const val TAG = "k7-backend"
    // What the backend prints once it listens, when STUDIO_READY_LINE asks it to (apps/k7/backend/src/server.ts).
    private const val READY_LINE = "k7-backend-ready"
    private const val POLL_MS = 1_000L
    private const val RETRY_MS = 200L
    // What Process.waitFor returns for a child ended by SIGKILL: 128 + 9.
    private const val KILLED_EXIT = 137
    private const val MAX_KILLED_EXITS = 20
    private const val PROBE_EVERY_MS = 20_000L
    private const val PROBE_TIMEOUT_MS = 5_000
    private const val PROBE_MISSES = 3
    private const val BUNDLE_ASSET = "backend.zip"
    private const val TABLE = "standalone.json"
    private const val TOOLS_ASSETS = "termux"
    // Each unpacked file's CRC and size, what the next update compares against.
    private const val ENTRIES = ".entries"
    // Written beside the zip's files, so never stale.
    private val OWN_FILES = setOf(".installed", ENTRIES, "cacert.pem", "termux-versions.json")
    private const val READY_MS = 60_000L
    private const val RELAUNCH_FIRST_MS = 2_000L
    private const val RELAUNCH_MAX_MS = 60_000L
    // A run this long is no crash at boot: the count of quick exits starts over.
    private const val HEALTHY_MS = 60_000L
    private const val MAX_QUICK_EXITS = 6
}
