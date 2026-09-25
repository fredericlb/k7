// MainActivity.kt — the whole app for now: start the engine, keep the screen on, say where to dial it.
// FOREGROUND ONLY: there is no service, so leaving this activity stops the engine and ends the process,
// which is also the only way to restart one (EngineBridge). See docs/android.md.

package se.frediver.st0

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.net.Inet4Address
import kotlin.system.exitProcess

class MainActivity : Activity() {
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        status = TextView(this).apply { textSize = 20f; gravity = Gravity.CENTER }
        val stop = Button(this).apply { text = "Stop"; setOnClickListener { finish() } }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
            addView(status)
            addView(stop)
        })

        // The engine opens its device WITH inputs, so ask first; a refusal still starts it, output only.
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
            startEngine()
        else
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_AUDIO)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_AUDIO) startEngine()
    }

    override fun onDestroy() {
        super.onDestroy()
        if (!isFinishing) return
        EngineBridge.stop(STOP_TIMEOUT_MS)
        exitProcess(0)
    }

    private fun startEngine() {
        status.text = "starting…"
        EngineBridge.start(this) { rc -> runOnUiThread { status.text = "engine stopped ($rc)" } }
        status.text = "listening on\nws://${lanAddress() ?: "127.0.0.1"}:${EngineBridge.PORT}"
    }

    // The active network's IPv4, which is what a browser on the same LAN dials.
    private fun lanAddress(): String? {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return null
        val links = cm.getLinkProperties(cm.activeNetwork) ?: return null
        return links.linkAddresses.map { it.address }.filterIsInstance<Inet4Address>().firstOrNull()?.hostAddress
    }

    private companion object {
        const val REQUEST_AUDIO = 1
        const val STOP_TIMEOUT_MS = 3000L
    }
}
