// MainActivity.kt — the tray, on a phone: starts the supervisor (which starts the engine), draws its
// snapshot, and sends the few commands a phone needs — connect a studio, disconnect one, quit. FOREGROUND
// ONLY: there is no service, so leaving this activity quits the supervisor and ends the process, which is
// also the only way to restart an engine (EngineBridge). See docs/android.md.

package se.frediver.st0

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject
import java.net.Inet4Address
import kotlin.system.exitProcess

class MainActivity : Activity(), SupervisorHost.Listener {
    private lateinit var status: TextView
    private lateinit var studios: LinearLayout
    private lateinit var check: TextView
    private lateinit var cas: TextView
    private var engineExit: Int? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        status = TextView(this).apply { textSize = 18f }
        studios = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        check = TextView(this)
        val address = EditText(this).apply {
            hint = "https://studio.example"
            inputType = InputType.TYPE_TEXT_VARIATION_URI
        }
        val connect = Button(this).apply {
            text = "Connect a studio"
            setOnClickListener {
                val url = address.text.toString().trim()
                if (url.isNotEmpty()) SupervisorHost.command("weburi.add", url)
            }
        }
        cas = TextView(this)
        val trust = Button(this).apply {
            text = "Trust a CA certificate…"
            setOnClickListener {
                val pick = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                startActivityForResult(pick, REQUEST_CA)
            }
        }
        val forget = Button(this).apply {
            text = "Forget trusted CAs"
            setOnClickListener {
                TrustedCas.forget(this@MainActivity)
                applyCas("trusting Android's CAs only")
            }
        }
        val quit = Button(this).apply { text = "Quit"; setOnClickListener { finish() } }
        setContentView(ScrollView(this).apply {
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                setPadding(48, 48, 48, 48)
                addView(status)
                addView(label("Studios"))
                addView(studios)
                addView(address)
                addView(connect)
                addView(check)
                addView(privateCa(trust, forget))
                addView(quit)
            })
        })
        status.text = "starting…"
        drawCas(null)
        SupervisorHost.listen(this)

        // The engine opens its device WITH inputs, so ask first; a refusal still starts it, output only.
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
            startSupervisor()
        else
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_AUDIO)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_AUDIO) startSupervisor()
    }

    @Deprecated("the platform Activity has no other way to receive a picked document")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data
        if (requestCode != REQUEST_CA || resultCode != RESULT_OK || uri == null) return
        val outcome = runCatching { TrustedCas.import(this, uri) }
        outcome.onSuccess { added ->
            applyCas(if (added.isEmpty()) "already trusted" else "now trusting ${added.joinToString("; ")}")
        }.onFailure { drawCas("not a certificate: ${it.message}") }
    }

    override fun onDestroy() {
        super.onDestroy()
        SupervisorHost.listen(null)
        // Android recreates this activity on its own; only the user leaving ends the process.
        if (!isFinishing) return
        // Supervisor FIRST: it deregisters while the engine still answers, then asks the engine to stop.
        SupervisorHost.stop(SUPERVISOR_STOP_MS)
        EngineBridge.stop(ENGINE_STOP_MS)
        exitProcess(0)
    }

    override fun onState(frame: JSONObject) = runOnUiThread { draw(frame) }

    override fun onEngineExit(code: Int) = runOnUiThread {
        engineExit = code
        status.text = "engine stopped ($code)"
    }

    private fun startSupervisor() = SupervisorHost.start(this)

    private fun draw(frame: JSONObject) {
        if (engineExit != null) return
        val state = frame.optString("status")
        val lines = mutableListOf(
            when (state) {
                "running" -> "engine running on\nws://${lanAddress() ?: "127.0.0.1"}:${frame.optInt("enginePort")}"
                "error" -> "engine: ${frame.optString("error")}"
                else -> "engine $state"
            },
        )
        val listed = frame.optJSONArray("instances")?.length() ?: 0
        if (listed > 0) lines += if (frame.optBoolean("lastHeartbeatOk")) "listed at every studio" else "a studio is not answering"
        status.text = lines.joinToString("\n")

        studios.removeAllViews()
        val rows = frame.optJSONArray("instances")
        if (rows == null || rows.length() == 0) studios.addView(TextView(this).apply { text = "none connected" })
        for (i in 0 until (rows?.length() ?: 0)) {
            val row = rows!!.getJSONObject(i)
            val url = row.optString("url")
            studios.addView(LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(this@MainActivity).apply {
                    text = url
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                if (row.optBoolean("removable")) addView(Button(this@MainActivity).apply {
                    text = "Remove"
                    setOnClickListener { SupervisorHost.command("weburi.remove", url) }
                })
            })
        }

        val c = frame.optJSONObject("instanceCheck")
        check.text = when (c?.optString("state")) {
            "checking" -> "checking ${c.optString("url")}…"
            "refused" -> c.optString("message")
            else -> ""
        }
    }

    // The supervisor reads its roots once, at start: a new one takes the change and adopts the running engine.
    private fun applyCas(said: String) {
        drawCas("$said — reconnecting…")
        Thread({
            SupervisorHost.restart(applicationContext, SUPERVISOR_STOP_MS)
            runOnUiThread { drawCas(said) }
        }, "st0-supervisor-restart").start()
    }

    private fun drawCas(said: String?) {
        val n = TrustedCas.count(this)
        val base = if (n == 0) "Android's CAs only" else "Android's CAs and $n of yours"
        cas.text = if (said == null) base else "$base\n$said"
    }

    // Collapsed unless one is already trusted: a studio with a public certificate, the usual case, needs nothing here.
    private fun privateCa(trust: Button, forget: Button): LinearLayout {
        val why = TextView(this).apply {
            text = "Only needed when your studio's HTTPS certificate is signed by a certificate authority " +
                "of your own — a home server or a company network running its own CA. Studios with a " +
                "public certificate, such as Let's Encrypt, connect without anything here.\n\n" +
                "Android does not let apps use the CAs installed in Settings, so a private one is added " +
                "here instead: pick its certificate file (.pem, .crt or .der)."
            setPadding(0, 8, 0, 8)
        }
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(why)
            addView(cas)
            addView(trust)
            addView(forget)
        }
        val toggle = Button(this)
        fun show(open: Boolean) {
            body.visibility = if (open) android.view.View.VISIBLE else android.view.View.GONE
            toggle.text = if (open) "Private CA (optional) ▾" else "Private CA (optional) ▸"
        }
        toggle.setOnClickListener { show(body.visibility != android.view.View.VISIBLE) }
        show(TrustedCas.count(this) > 0)
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 32, 0, 0)
            addView(toggle)
            addView(body)
        }
    }

    private fun label(text: String) = TextView(this).apply { this.text = text; textSize = 16f; setPadding(0, 32, 0, 8) }

    // The active network's IPv4, which is what a browser on the same LAN dials.
    private fun lanAddress(): String? {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return null
        val links = cm.getLinkProperties(cm.activeNetwork) ?: return null
        return links.linkAddresses.map { it.address }.filterIsInstance<Inet4Address>().firstOrNull()?.hostAddress
    }

    private companion object {
        const val REQUEST_AUDIO = 1
        const val REQUEST_CA = 2
        const val SUPERVISOR_STOP_MS = 4000L
        const val ENGINE_STOP_MS = 3000L
    }
}
