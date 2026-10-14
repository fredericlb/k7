// MainActivity.kt — the app, on a phone: starts k7's backend (BackendHost) and the supervisor (which starts the engine), and hosts the
// page that draws the engine tray while no studio is connected, and over it the studio apps (k7, the
// media library and the rehearsal recorder among its pages) in full-screen views of their own. The page is web/, bundled; the two plugins registered here are
// its only way to the native half. Leaving this activity quits the supervisor and ends the process, which is also the
// only way to restart an engine (EngineBridge); MediaPlaybackService only keeps the process in front while a page plays.
// See docs/android.md.

package se.frediver.k7

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.WindowManager
import com.getcapacitor.BridgeActivity
import kotlin.system.exitProcess

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Before super: the bridge is built there, with the plugins registered by then.
        registerPlugin(EnginePlugin::class.java)
        registerPlugin(AppViewsPlugin::class.java)
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // The studio the views open, before the engine that lists itself there (BackendHost.kt).
        BackendHost.start(this)

        // The engine opens its device WITH inputs, so ask first; a refusal still starts it, output only.
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
            SupervisorHost.start(this)
        else
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_AUDIO)
    }

    @Deprecated("the platform callback; Capacitor's own permission flow still ends up here too")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_AUDIO) SupervisorHost.start(this)
    }

    override fun onDestroy() {
        super.onDestroy()
        // Android recreates this activity on its own; only the user leaving ends the process.
        if (!isFinishing) return
        // A paused track's notification is detached from any service, so it would outlive the process otherwise.
        MediaPlayback.clear(this)
        // Supervisor FIRST: it deregisters while the engine still answers, then asks the engine to stop.
        SupervisorHost.stop(SUPERVISOR_STOP_MS)
        EngineBridge.stop(ENGINE_STOP_MS)
        BackendHost.stop(BACKEND_STOP_MS)
        exitProcess(0)
    }

    companion object {
        private const val REQUEST_AUDIO = 1
        const val SUPERVISOR_STOP_MS = 4000L
        private const val ENGINE_STOP_MS = 3000L
        private const val BACKEND_STOP_MS = 3000L
    }
}
