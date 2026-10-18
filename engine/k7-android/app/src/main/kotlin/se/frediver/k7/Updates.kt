// Updates.kt — keeps the sideloaded app current from k7.rocks/app_downloads: 5 s after start, then every 6 hours while
// the process lives, asks the channel's build; a newer APK is downloaded on an unmetered network only, then offered —
// a notification, and a dialog when the app is in front and idle. Install hands it to PackageInstaller, which restarts k7.
// The first update always asks the person (and for "install unknown apps"); once k7 installed itself, Android 12+ lets
// the next ones through without a prompt. Never while Busy says the app is at work. See docs/android.md.

package se.frediver.k7

import android.app.AlertDialog
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.ConnectivityManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast
import androidx.lifecycle.Lifecycle
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

object Updates {
    /** The notification's tap, delivered to MainActivity (onCreate or onNewIntent). */
    const val INSTALL = "se.frediver.k7.UPDATE_INSTALL"
    private const val STATUS = "se.frediver.k7.UPDATE_STATUS"
    private const val TAG = "k7-update"
    private const val CHANNEL = "updates"
    private const val NOTIFICATION = 3
    // At every start, once the app is up; the home menu's Check for updates asks at any time (checkNow).
    private const val FIRST_CHECK_MS = 5_000L
    private const val EVERY_MS = 6 * 3600_000L
    private val STAMP = BuildConfig.RELEASE_STAMP

    private var started = false
    // The stamp a dialog was shown for, so a check every 6 hours does not ask again in the same run.
    @Volatile private var asked: String? = null
    @Volatile private var installing = false
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadScheduledExecutor { Thread(it, "k7-update").apply { isDaemon = true } }

    /** Once per process; nothing at all for a build CI did not stamp (a checkout's, the e2e one). */
    fun start(context: Context) {
        if (started || UpdateCheck.channelOf(STAMP) == null) return
        started = true
        val app = context.applicationContext
        worker.scheduleWithFixedDelay(
            { runCatching { check(app) }.onFailure { Log.w(TAG, "check failed: ${it.message}") } },
            FIRST_CHECK_MS,
            EVERY_MS,
            TimeUnit.MILLISECONDS,
        )
    }

    /** MainActivity's intent: the notification's Install. */
    fun handle(activity: MainActivity, intent: Intent?) {
        if (intent?.action != INSTALL) return
        // Consumed, so an activity Android recreates with the same intent does not install again.
        intent.action = null
        install(activity)
    }

    private fun dir(app: Context) = File(app.cacheDir, "updates").apply { mkdirs() }

    /** The home menu's Check for updates (StudioBridge `checkUpdates`): asks now, on any network, and always answers. */
    fun checkNow(context: Context) {
        val app = context.applicationContext
        if (UpdateCheck.channelOf(STAMP) == null) {
            say(app, "This build is not a release, so there is nothing to compare it with")
            return
        }
        say(app, "Checking for updates…")
        worker.execute {
            runCatching { check(app, manual = true) }.onFailure {
                Log.w(TAG, "check failed: ${it.message}")
                say(app, "Could not check for updates: ${it.message ?: "no answer from k7.rocks"}")
            }
        }
    }

    private fun say(app: Context, text: String) {
        main.post { Toast.makeText(app, text, Toast.LENGTH_LONG).show() }
    }

    private fun check(app: Context, manual: Boolean = false) {
        val channel = UpdateCheck.channelOf(STAMP) ?: return
        val build = fetchJson("${UpdateCheck.DOWNLOADS}/$channel.json")
        val served = build?.optString("stamp").orEmpty()
        val files = build?.optJSONArray("files")
        val sizes = (0 until (files?.length() ?: 0)).mapNotNull { files!!.optJSONObject(it) }
            .associate { it.optString("name") to it.optLong("bytes") }
        val apk = UpdateCheck.apkOf(sizes.keys.toList())
        // What an older check downloaded goes, unless it is still the build to install.
        dir(app).listFiles()?.filter { it.name != apk }?.forEach { it.delete() }
        if (apk == null || !UpdateCheck.isNewer(STAMP, served)) {
            if (manual) say(app, "k7 ${UpdateCheck.label(STAMP)} is the latest")
            return
        }
        val target = File(dir(app), apk)
        if (!target.isFile) {
            val cm = app.getSystemService(ConnectivityManager::class.java)
            // The person asked: their check downloads on mobile data too.
            if (!manual && cm.isActiveNetworkMetered) {
                Log.i(TAG, "k7 $served is out; waiting for an unmetered network")
                return
            }
            Log.i(TAG, "downloading k7 $served")
            if (manual) say(app, "Downloading k7 ${UpdateCheck.label(served)}…")
            download("${UpdateCheck.DOWNLOADS}/$channel/$apk", target, sizes[apk] ?: 0)
        }
        if (!newerThanInstalled(app, target)) {
            Log.w(TAG, "$apk is not a later build of this app; dropped")
            target.delete()
            if (manual) say(app, "k7 ${UpdateCheck.label(STAMP)} is the latest")
            return
        }
        announce(app, served, manual)
    }

    private fun connect(url: String, readMs: Int) = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 15_000
        readTimeout = readMs
        setRequestProperty("User-Agent", "k7-android")
    }

    /** The channel's build, or null when it has none yet. */
    private fun fetchJson(url: String): JSONObject? {
        val c = connect(url, 30_000)
        try {
            if (c.responseCode == 404) return null
            if (c.responseCode != 200) throw IOException("HTTP ${c.responseCode} from $url")
            return JSONObject(c.inputStream.bufferedReader().use { it.readText() })
        } finally {
            c.disconnect()
        }
    }

    private fun download(url: String, target: File, bytes: Long) {
        val part = File(target.path + ".part")
        val c = connect(url, 60_000)
        try {
            if (c.responseCode != 200) throw IOException("HTTP ${c.responseCode} from $url")
            c.inputStream.use { input -> part.outputStream().use { input.copyTo(it) } }
        } finally {
            c.disconnect()
        }
        if (bytes > 0 && part.length() != bytes) {
            part.delete()
            throw IOException("${target.name}: ${part.length()} bytes of $bytes")
        }
        if (!part.renameTo(target)) throw IOException("could not keep ${target.name}")
    }

    /** This app's package at a higher versionCode: Android would refuse anything else, so it is never offered. */
    private fun newerThanInstalled(app: Context, file: File): Boolean {
        val pm = app.packageManager
        val info = pm.getPackageArchiveInfo(file.path, 0) ?: return false
        return info.packageName == app.packageName &&
            info.longVersionCode > pm.getPackageInfo(app.packageName, 0).longVersionCode
    }

    /** The downloaded APK still to install, if any. */
    private fun pending(app: Context): File? =
        dir(app).listFiles()?.firstOrNull { UpdateCheck.apkOf(listOf(it.name)) != null && newerThanInstalled(app, it) }

    private fun announce(app: Context, stamp: String, manual: Boolean = false) {
        val name = UpdateCheck.label(stamp)
        notify(app, "k7 $name is ready", "Tap to install. k7 restarts.")
        main.post {
            val activity = MainActivity.current() ?: return@post
            // The person's own check always gets its dialog; an automatic one asks once, and never over work.
            val quiet = !manual && (asked == stamp || Busy.busy)
            if (quiet || !activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) return@post
            asked = stamp
            AlertDialog.Builder(activity)
                .setTitle("k7 $name is ready")
                .setMessage("This is k7 ${UpdateCheck.label(STAMP)}. Installing the update restarts k7.")
                .setPositiveButton("Install") { _, _ -> install(activity) }
                .setNegativeButton("Later", null)
                .show()
        }
    }

    private fun notify(app: Context, title: String, text: String) {
        val nm = app.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Updates", NotificationManager.IMPORTANCE_DEFAULT))
        // An activity, not a receiver: Android 12+ refuses an activity started from a notification's broadcast.
        val tap = PendingIntent.getActivity(
            app,
            NOTIFICATION,
            Intent(app, MainActivity::class.java).setAction(INSTALL).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val shown = Notification.Builder(app, CHANNEL)
            .setSmallIcon(R.drawable.ic_media)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build()
        // Without POST_NOTIFICATIONS it is simply not shown; the dialog says the same when the app is in front.
        runCatching { nm.notify(NOTIFICATION, shown) }
    }

    private fun install(activity: MainActivity) {
        val app = activity.applicationContext
        if (Busy.busy) {
            Toast.makeText(activity, "k7 is at work: install the update once it stops", Toast.LENGTH_LONG).show()
            return
        }
        if (installing) return
        installing = true
        // Off the UI thread: the APK is hundreds of megabytes to copy into the session.
        thread(name = "k7-update-install") {
            runCatching {
                val apk = pending(app) ?: throw IOException("no downloaded update")
                commit(app, apk)
            }.onFailure { failed(app, it.message) }
        }
    }

    private fun commit(app: Context, apk: File) {
        val installer = app.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(app.packageName)
            // Honoured once k7 is its own installer of record; the first update still asks.
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            apk.inputStream().use { input ->
                session.openWrite("k7.apk", 0, apk.length()).use { out ->
                    input.copyTo(out)
                    session.fsync(out)
                }
            }
            // Mutable: PackageInstaller fills in the status extras.
            val status = PendingIntent.getBroadcast(
                app,
                id,
                Intent(app, Status::class.java).setAction(STATUS),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            session.commit(status.intentSender)
        }
    }

    private fun failed(app: Context, why: String?) {
        installing = false
        Log.w(TAG, "install failed: $why")
        main.post { Toast.makeText(app, "The k7 update did not install: ${why ?: "unknown error"}", Toast.LENGTH_LONG).show() }
    }

    /** PackageInstaller's answer: a confirmation to show, or how it ended. On success Android ends this process itself. */
    class Status : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    val confirm = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                    else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
                    // The app is in front: the person just tapped Install, so it may start the system's dialog.
                    runCatching { context.startActivity(confirm!!.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                        .onFailure { failed(context.applicationContext, it.message) }
                }
                PackageInstaller.STATUS_SUCCESS -> Log.i(TAG, "installed")
                // Aborted is the person's Cancel: nothing to tell them.
                PackageInstaller.STATUS_FAILURE_ABORTED -> installing = false
                else -> failed(context.applicationContext, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "status $status")
            }
        }
    }
}
