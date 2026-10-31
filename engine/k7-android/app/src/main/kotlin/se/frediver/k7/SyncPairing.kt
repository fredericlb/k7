// SyncPairing.kt — pair the account signed in on the phone's own studio with the ORIGIN's relay, once, through
// the system browser. The pairing itself is the phone's backend's (packages/file-hub/pairRoutes.ts, the desktop's
// too): this asks it whether to offer one, asks the person, opens the URL it answers in a browser, and says how it
// ended. The browser brings the token back to the backend's own port, and the backend keeps the pairing under way
// on disk, so a process killed behind the browser is told the ending at its next start. The link takes whichever
// account the browser confirms on the server, the phone's own or another. See docs/android.md.

package se.frediver.k7

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch

object SyncPairing {
    /** web-protocol's STUDIO_ORIGIN: the server a phone syncs with until the sign-in popin names another. */
    private const val DEFAULT_ORIGIN = "https://app.k7.rocks"
    private const val SERVER_PREFS = "k7-sync-server"
    /** The phone's backend's pairing routes (packages/file-hub/pairRoutes.ts). */
    private const val PAIR_API = "/api/sync/remote/pair"
    /** One long poll of the backend while the browser is in front. */
    private const val POLL_MS = 25_000
    private const val TAG = "k7-sync"

    // Accounts asked this run: a pairing the person declined is not offered again at every page load.
    private val asked = mutableSetOf<String>()
    private var busy = false
    private val main = Handler(Looper.getMainLooper())

    /** Keep the server the sign-in popin named, when it is one: https, or http on this phone only. */
    fun choose(context: Context, input: String?) {
        val origin = normalize(input) ?: return
        context.getSharedPreferences(SERVER_PREFS, Context.MODE_PRIVATE).edit().putString("origin", origin).apply()
    }

    private fun normalize(input: String?): String? {
        val u = input?.trim()?.takeIf { it.isNotEmpty() }?.let(Uri::parse) ?: return null
        val host = u.host?.lowercase() ?: return null
        val loopback = host == "127.0.0.1" || host == "localhost" || host == "[::1]"
        if (u.scheme != "https" && !(u.scheme == "http" && loopback)) return null
        if (u.userInfo != null) return null
        return if (u.port > 0) "${u.scheme}://$host:${u.port}" else "${u.scheme}://$host"
    }

    private fun origin(context: Context): String =
        context.getSharedPreferences(SERVER_PREFS, Context.MODE_PRIVATE).getString("origin", null) ?: DEFAULT_ORIGIN

    private fun host(context: Context): String = Uri.parse(origin(context)).host ?: origin(context)

    /** Pair the account signed in to the phone's studio, unless it is the local user, already paired, or asked this run. */
    fun pairIfNeeded(context: Context, cookie: String?) {
        if (cookie.isNullOrEmpty()) return
        synchronized(this) {
            if (busy) return
            busy = true
        }
        val app = context.applicationContext
        Thread({
            try {
                run(app, cookie)
            } catch (e: Exception) {
                Log.w(TAG, "sync pairing: ${e.message}")
            } finally {
                synchronized(this) { busy = false }
            }
        }, "k7-sync-pair").start()
    }

    private fun run(context: Context, cookie: String) {
        val offer = local("GET", "$PAIR_API?origin=${Uri.encode(origin(context))}", cookie) ?: return
        val email = offer.text("email").takeIf { it.isNotEmpty() } ?: return
        if (offer.optBoolean("local")) return
        // A pairing this process was killed behind: still waited for, or ended while nobody was here to say so.
        offer.optJSONObject("pairing")?.let {
            synchronized(this) { asked.add(email) }
            if (it.text("phase") == "waiting") tell(context, "Finishing this phone's sync pairing: if the browser shows an error page, reload it.")
            return settle(context, it, cookie)
        }
        if (synchronized(this) { !asked.add(email) }) return
        // Already a server of this account, main or not, as on desktop: another one chosen is paired as the main.
        if (offer.optBoolean("paired")) return
        if (!ask(context, "Sync this phone's workspaces with ${host(context)}?\n\nThe browser opens to confirm the account there: $email, or another one.", "Sync")) return
        val body = JSONObject().put("origin", origin(context)).put("name", deviceName())
        val started = local("POST", PAIR_API, cookie, body)
            ?: return tell(context, "This phone's sync pairing could not start. k7 will offer it again at its next start.")
        val pairing = started.getJSONObject("pairing")
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(started.getString("url"))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
            local("DELETE", "$PAIR_API/${pairing.text("state")}", cookie)
            return tell(context, "There is no browser on this phone to pair it with ${host(context)} in.")
        }
        settle(context, pairing, cookie)
    }

    /** Wait on the backend for the pairing's ending, say it, and let the backend drop it. */
    private fun settle(context: Context, first: JSONObject, cookie: String) {
        val state = first.text("state")
        var p = first
        while (p.text("phase") == "waiting") {
            p = local("GET", "$PAIR_API/$state?wait=$POLL_MS", cookie)?.optJSONObject("pairing")
                ?: return tell(context, "The sync pairing was interrupted. k7 will offer it again at its next start.")
        }
        local("DELETE", "$PAIR_API/$state", cookie)
        val host = p.text("host")
        Log.i(TAG, "sync pairing with $host: ${p.text("phase")}")
        when (p.text("phase")) {
            "paired" -> {
                // The same token lists this phone's engine at that studio, which may admit paired machines only.
                SupervisorHost.rememberDeviceToken(context, p.text("origin"), p.text("token"))
                tell(context, "This phone now syncs its workspaces with $host as ${account(p)}.")
            }
            // That account on that server is linked already: the link it has stays.
            "alreadyLinked", "otherAccount" ->
                tell(context, "This phone already syncs with $host as ${account(p)}, so nothing changed.")
            "expired" -> tell(context, "The sync pairing was not finished in the browser. k7 will offer it again at its next start.")
            else -> tell(context, "The sync pairing could not be saved on this phone. k7 will offer it again at its next start.")
        }
    }

    /** A yes or no in a dialog over the app, waited for on this thread; no activity to draw it is a no. */
    private fun ask(context: Context, question: String, yes: String): Boolean {
        val done = CountDownLatch(1)
        var said = false
        main.post {
            val activity = MainActivity.current() ?: return@post done.countDown()
            AlertDialog.Builder(activity)
                .setTitle("Sync")
                .setMessage(question)
                .setPositiveButton(yes) { _, _ -> said = true }
                .setNegativeButton("Not now", null)
                .setOnDismissListener { done.countDown() }
                .show()
        }
        done.await()
        if (!said) Log.i(TAG, "sync pairing declined")
        return said
    }

    // A toast is what reaches the person whether the app or the browser is in front.
    private fun tell(context: Context, said: String) {
        main.post { Toast.makeText(context, said, Toast.LENGTH_LONG).show() }
    }

    /** The server's account the pairing ended as: the browser's, else the phone's own. */
    private fun account(p: JSONObject): String = p.text("browserAs").ifEmpty { p.text("email") }

    // A JSON null reads as "", where optString would answer "null".
    private fun JSONObject.text(name: String): String = if (isNull(name)) "" else optString(name)

    /** The phone's backend, as the signed-in account: its session cookie, read from the views' CookieManager. */
    private fun local(method: String, path: String, cookie: String, body: JSONObject? = null): JSONObject? {
        val c = URL(BackendHost.ORIGIN + path).openConnection() as HttpURLConnection
        return try {
            c.requestMethod = method
            c.connectTimeout = 5_000
            // Longer than one long poll of a pairing under way.
            c.readTimeout = 60_000
            c.setRequestProperty("Cookie", cookie)
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            if (c.responseCode !in 200..299) null else JSONObject(c.inputStream.bufferedReader().readText())
        } catch (_: IOException) {
            null
        } finally {
            c.disconnect()
        }
    }

    /** What the origin's device list shows: the phone's maker and model. */
    private fun deviceName(): String {
        val model = Build.MODEL.orEmpty()
        val maker = Build.MANUFACTURER.orEmpty().replaceFirstChar { it.uppercase() }
        return if (model.startsWith(maker, ignoreCase = true)) model else "$maker $model".trim()
    }
}
