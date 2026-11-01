// SyncPairing.kt — sign the phone in to its ONE server: signing in IS the pairing. The phone's backend gives the
// server's sign-in URL (packages/file-hub/pairRoutes.ts, the tray's too), opened in a Custom Tab over the app; the server
// sends a one-use code back to this app's scheme, and the backend trades it for the link. The backend keeps a sign-in
// under way on disk, so a process killed behind the browser is told the ending at its next start. See docs/android.md.

package se.frediver.k7

import android.app.Activity
import android.content.Context
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

object SyncPairing {
    /** web-protocol's STUDIO_ORIGIN: the server a phone signs in to when the page names none. */
    private const val DEFAULT_ORIGIN = "https://app.k7.rocks"
    /** The app's own scheme, its application id: the server sends its code to `<scheme>://pair`. */
    private val SCHEME: String = BuildConfig.APPLICATION_ID
    private const val HOST = "pair"
    /** The phone's backend's sign-in routes, and the return that trades the server's code (packages/file-hub/pairRoutes.ts). */
    private const val PAIR_API = "/api/sync/remote/pair"
    private const val RETURN = "/desktop/sync-pair"
    /** One long poll of the backend while the trade finishes. */
    private const val POLL_MS = 25_000
    private const val TAG = "k7-sync"

    private val main = Handler(Looper.getMainLooper())

    private fun normalize(input: String?): String? {
        val u = input?.trim()?.takeIf { it.isNotEmpty() }?.let(Uri::parse) ?: return null
        val host = u.host?.lowercase() ?: return null
        val loopback = host == "127.0.0.1" || host == "localhost" || host == "[::1]"
        if (u.scheme != "https" && !(u.scheme == "http" && loopback)) return null
        if (u.userInfo != null) return null
        return if (u.port > 0) "${u.scheme}://$host:${u.port}" else "${u.scheme}://$host"
    }

    /** Is this intent the server's answer to a sign-in started here? */
    fun isAnswer(answer: Uri): Boolean = answer.scheme == SCHEME && answer.host == HOST

    /** Start a sign-in to `input` from the page's `/auth/login?server=`: the server's page opens over the app. */
    fun start(activity: Activity, input: String?, cookie: String?) {
        val origin = normalize(input) ?: DEFAULT_ORIGIN
        Thread({
            val body = JSONObject().put("origin", origin).put("name", deviceName()).put("scheme", SCHEME)
            val started = local("POST", PAIR_API, cookie, body)
            main.post {
                val url = started?.optString("url")?.takeIf { it.isNotEmpty() }
                    ?: return@post tell(activity, "The sign-in to ${Uri.parse(origin).host} could not start. Try again.")
                if (AuthHandoff.openTab(activity, Uri.parse(url)) || activity.isFinishing) return@post
                // Not even a plain browser: said in a native dialog, since the page that asked is the one that cannot go on.
                AlertDialog.Builder(activity)
                    .setTitle("k7")
                    .setMessage("No web browser to sign in with. Install or enable one, then sign in again.")
                    .setPositiveButton(android.R.string.ok, null)
                    .show()
            }
        }, "k7-sync-sign-in").start()
    }

    /** The server's answer came back: the backend trades its code, then the ending is said; `onPaired` runs on the main thread. */
    fun finish(context: Context, answer: Uri, cookie: String?, onPaired: () -> Unit) {
        val app = context.applicationContext
        Thread({
            try {
                val state = answer.getQueryParameter("state").orEmpty()
                val code = answer.getQueryParameter("code").orEmpty()
                // The return the tray's browser lands on: no session, the state is the gate.
                trade("$RETURN?code=${Uri.encode(code)}&state=${Uri.encode(state)}")
                val pairing = local("GET", "$PAIR_API/${Uri.encode(state)}", cookie)?.optJSONObject("pairing")
                    ?: return@Thread tell(app, "The sign-in was interrupted. Sign in again from the settings.")
                settle(app, pairing, cookie, onPaired)
            } catch (e: Exception) {
                Log.w(TAG, "sign-in: ${e.message}")
            }
        }, "k7-sync-finish").start()
    }

    /** At a page load: a sign-in that ended while nobody was here to say so is said now. */
    fun resume(context: Context, cookie: String?, onPaired: () -> Unit) {
        if (cookie.isNullOrEmpty()) return
        val app = context.applicationContext
        Thread({
            val p = local("GET", PAIR_API, cookie)?.optJSONObject("pairing") ?: return@Thread
            if (p.text("phase") != "waiting") settle(app, p, cookie, onPaired)
        }, "k7-sync-resume").start()
    }

    /** Wait on the backend for the ending, say it, and let the backend drop it. */
    private fun settle(context: Context, first: JSONObject, cookie: String?, onPaired: () -> Unit) {
        val state = first.text("state")
        var p = first
        while (p.text("phase") == "waiting") {
            p = local("GET", "$PAIR_API/$state?wait=$POLL_MS", cookie)?.optJSONObject("pairing")
                ?: return tell(context, "The sign-in was interrupted. Sign in again from the settings.")
        }
        local("DELETE", "$PAIR_API/$state", cookie)
        val host = p.text("host")
        Log.i(TAG, "sign-in to $host: ${p.text("phase")}")
        when (p.text("phase")) {
            "paired" -> {
                // The same token lists this phone's engine at that server, which may admit paired machines only.
                SupervisorHost.rememberDeviceToken(context, p.text("origin"), p.text("token"))
                tell(context, "Signed in to $host as ${p.text("browserAs")}.")
                // The page read the server list before the link existed: it reads it again.
                main.post(onPaired)
            }
            "expired" -> tell(context, "The sign-in was not finished in the browser. Sign in again from the settings.")
            else -> tell(context, "The sign-in could not be saved on this phone. Sign in again from the settings.")
        }
    }

    // A toast is what reaches the person whether the app or the browser is in front.
    private fun tell(context: Context, said: String) {
        main.post { Toast.makeText(context, said, Toast.LENGTH_LONG).show() }
    }

    // A JSON null reads as "", where optString would answer "null".
    private fun JSONObject.text(name: String): String = if (isNull(name)) "" else optString(name)

    /** The backend's return, which answers a page rather than JSON: only its having answered matters. */
    private fun trade(path: String) {
        val c = URL(BackendHost.ORIGIN + path).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 5_000
            // The backend asks the server meanwhile, which may be slow.
            c.readTimeout = 60_000
            c.responseCode
        } catch (_: IOException) {
            // The ending is read from the pairing itself.
        } finally {
            c.disconnect()
        }
    }

    /** The phone's backend, as the view's session: its cookie, read from the views' CookieManager. */
    private fun local(method: String, path: String, cookie: String?, body: JSONObject? = null): JSONObject? {
        val c = URL(BackendHost.ORIGIN + path).openConnection() as HttpURLConnection
        return try {
            c.requestMethod = method
            c.connectTimeout = 5_000
            // Longer than one long poll of a sign-in under way.
            c.readTimeout = 60_000
            if (!cookie.isNullOrEmpty()) c.setRequestProperty("Cookie", cookie)
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

    /** What the server's device list shows: the phone's maker and model. */
    private fun deviceName(): String {
        val model = Build.MODEL.orEmpty()
        val maker = Build.MANUFACTURER.orEmpty().replaceFirstChar { it.uppercase() }
        return if (model.startsWith(maker, ignoreCase = true)) model else "$maker $model".trim()
    }
}
