// MainActivity.kt — the app, on a phone: starts k7's backend (BackendHost) and the supervisor (which starts the engine), and hosts the
// page that draws the engine tray while no studio is connected, and over it the studio apps (k7, the
// media library and the rehearsal recorder among its pages) in full-screen views of their own. The page is web/, bundled; the two plugins registered here are
// its only way to the native half. Leaving this activity quits the supervisor and ends the process, which is also the
// only way to restart an engine (EngineBridge). The services only keep the process in front while it is busy (Busy.kt).
// A sideloaded release keeps itself current from k7.rocks/app_downloads (Updates.kt).
// See docs/android.md.

package se.frediver.k7

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.Lifecycle
import com.getcapacitor.BridgeActivity
import java.lang.ref.WeakReference
import kotlin.concurrent.thread
import kotlin.system.exitProcess

class MainActivity : BridgeActivity() {
    /** The microphone, asked when first needed (MicAccess.kt); null only before onCreate. */
    var mic: MicAccess? = null
        private set
    private var notificationsAsked = false
    private val notifications by lazy {
        activityResultRegistry.register("k7-notify", ActivityResultContracts.RequestPermission()) { }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Before super: the bridge is built there, with the plugins registered by then.
        registerPlugin(EnginePlugin::class.java)
        registerPlugin(AppViewsPlugin::class.java)
        super.onCreate(savedInstanceState)
        current = WeakReference(this)
        mic = MicAccess(this)
        // The studio the views open, before the engine that lists itself there (BackendHost.kt).
        BackendHost.start(this)
        // Never held up by the microphone: without it the engine opens its device output only (MicAccess.kt).
        SupervisorHost.start(this)
        Busy.start(this)
        Updates.start(this)
        Updates.handle(this, intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        Updates.handle(this, intent)
    }

    /** The screen kept on while the app is busy, and only then (Busy.kt). */
    fun keepScreenOn(on: Boolean) = runOnUiThread {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    /** POST_NOTIFICATIONS on Android 13+, once per run and only in front: without it the busy notification is hidden, not refused. */
    fun askNotifications() {
        if (Build.VERSION.SDK_INT < 33 || notificationsAsked || !lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) return
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        notificationsAsked = true
        notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    override fun onDestroy() {
        super.onDestroy()
        mic?.destroy()
        if (current?.get() === this) current = null
        // Android recreates this activity on its own; only the user leaving ends the process.
        if (!isFinishing) return
        // A paused track's notification is detached from any service, so it would outlive the process otherwise.
        MediaPlayback.clear(this)
        EngineService.release(this)
        // Off the UI thread: the stops below wait up to seconds each, and a blocked main thread is an ANR.
        thread(name = "k7-teardown") {
            // Supervisor FIRST: it deregisters while the engine and the backend still answer, then asks the engine to stop.
            SupervisorHost.stop(SUPERVISOR_STOP_MS)
            // The backend asked next, beside the engine: its own stop (file services, then requests) takes longest.
            val backend = thread(name = "k7-backend-stop") { BackendHost.stop(BACKEND_STOP_MS) }
            EngineBridge.stop(ENGINE_STOP_MS)
            backend.join()
            exitProcess(0)
        }
    }

    companion object {
        private var current: WeakReference<MainActivity>? = null

        /** The activity alive now, for what must draw a dialog or set a window flag from elsewhere. */
        fun current(): MainActivity? = current?.get()?.takeUnless { it.isFinishing || it.isDestroyed }

        const val SUPERVISOR_STOP_MS = 4000L
        private const val ENGINE_STOP_MS = 3000L
        // Longer than the backend's own 8 s stop, so its file services are not killed mid-teardown (apps/k7/backend/src/server.ts).
        private const val BACKEND_STOP_MS = 10_000L
    }
}
