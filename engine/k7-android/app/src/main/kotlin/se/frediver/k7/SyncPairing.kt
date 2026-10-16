// SyncPairing.kt — pair the account signed in on the phone's own studio with the ORIGIN's relay, once, through
// the system browser: the origin mints a device token and redirects it to a loopback port this process listens
// on, and the phone's backend keeps it for that account. Mirrors apps/k7-standalone/src/pairSync.ts.
// The person is asked in the app first, and told the outcome in the app. A pairing under way is kept on disk, so a
// process killed behind the browser listens again on the same port when it comes back. See docs/android.md.

package se.frediver.k7

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URL
import java.security.SecureRandom
import java.util.concurrent.CountDownLatch

object SyncPairing {
    /** web-protocol's STUDIO_ORIGIN: the one origin a phone's workspaces and libraries follow. */
    private const val SYNC_ORIGIN = "https://st0.app"
    private val SYNC_HOST = Uri.parse(SYNC_ORIGIN).host
    /** web-protocol's SYNC_PAIR_ROUTE and SYNC_PAIR_RETURN_PATH: the origin accepts only an http loopback return. */
    private const val PAIR_ROUTE = "/api/sync/devices/pair"
    private const val RETURN_PATH = "/desktop/sync-pair"
    /** A pairing left unfinished in the browser stops listening after this. */
    private const val WAIT_MS = 10 * 60_000L
    private const val TAG = "k7-sync"
    private const val PREFS = "k7-sync-pairing"

    // Accounts asked this run: a pairing the person declined is not offered again at every page load.
    private val asked = mutableSetOf<String>()
    private var busy = false
    // Set by the account-mismatch dialog's Try again, acted on once the thread that asked has let go of `busy`.
    @Volatile private var retry = false
    private val main = Handler(Looper.getMainLooper())

    /** A pairing whose browser answer is still awaited, as kept on disk. */
    private data class Pending(val email: String, val state: String, val port: Int, val until: Long)

    private sealed interface Outcome {
        object Paired : Outcome
        data class OtherAccount(val browserAs: String?) : Outcome
        object NotStored : Outcome
    }

    /** Pair the account signed in to the phone's studio, unless it is the local user, already paired, or asked this run. */
    fun pairIfNeeded(context: Context, cookie: String?) = launch(context, cookie, again = false)

    private fun launch(context: Context, cookie: String?, again: Boolean) {
        if (cookie.isNullOrEmpty()) return
        synchronized(this) {
            if (busy) return
            busy = true
        }
        val app = context.applicationContext
        Thread({
            try {
                run(app, cookie, again)
            } catch (e: Exception) {
                Log.w(TAG, "sync pairing: ${e.message}")
            } finally {
                synchronized(this) { busy = false }
            }
            if (retry) {
                retry = false
                launch(app, cookie, again = true)
            }
        }, "k7-sync-pair").start()
    }

    private fun run(context: Context, cookie: String, again: Boolean) {
        val user = local("GET", "/auth/me", cookie)?.optJSONObject("user") ?: return
        val email = user.optString("email").takeIf { it.isNotEmpty() } ?: return
        if (user.optBoolean("local")) return
        pending(context)?.let {
            if (it.email == email && System.currentTimeMillis() < it.until) return resume(context, it, cookie)
            forget(context)
        }
        if (!again && synchronized(this) { !asked.add(email) }) return
        val remote = local("GET", "/api/sync/remote", cookie) ?: return
        if (remote.optBoolean("paired")) return
        if (!again && !ask(context, "Sync this phone's workspaces with $SYNC_HOST?\n\nThe browser opens to confirm it as $email.", "Sync")) return
        val state = ByteArray(16).also { SecureRandom().nextBytes(it) }
            .let { Base64.encodeToString(it, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP) }
        ServerSocket(0, 4, InetAddress.getByName("127.0.0.1")).use { server ->
            val pending = Pending(email, state, server.localPort, System.currentTimeMillis() + WAIT_MS)
            remember(context, pending)
            val back = "http://127.0.0.1:${server.localPort}$RETURN_PATH"
            val url = Uri.parse(SYNC_ORIGIN + PAIR_ROUTE).buildUpon()
                .appendQueryParameter("return", back)
                .appendQueryParameter("state", state)
                .appendQueryParameter("name", deviceName())
                .build()
            try {
                context.startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (_: ActivityNotFoundException) {
                forget(context)
                return tell(context, "There is no browser on this phone to pair it with $SYNC_HOST in.")
            }
            listen(context, server, pending, cookie)
        }
    }

    /** The process died while the browser was in front: the same port and state again, and the browser's page reloaded does the rest. */
    private fun resume(context: Context, p: Pending, cookie: String) {
        synchronized(this) { asked.add(p.email) }
        val server = try {
            ServerSocket(p.port, 4, InetAddress.getByName("127.0.0.1"))
        } catch (_: IOException) {
            forget(context)
            return tell(context, "The sync pairing was interrupted. k7 will offer it again at its next start.")
        }
        tell(context, "Finishing this phone's sync pairing: if the browser shows an error page, reload it.")
        server.use { listen(context, it, p, cookie) }
    }

    private fun listen(context: Context, server: ServerSocket, p: Pending, cookie: String) {
        try {
            while (true) {
                val left = p.until - System.currentTimeMillis()
                if (left <= 0) return tell(context, "The sync pairing was not finished in the browser. k7 will offer it again at its next start.")
                server.soTimeout = left.toInt()
                val socket = try {
                    server.accept()
                } catch (_: SocketTimeoutException) {
                    continue
                }
                val outcome = socket.use { answer(context, it, p.state, p.email, cookie) } ?: continue
                return report(context, outcome, p.email)
            }
        } finally {
            forget(context)
        }
    }

    /** One request on the listener; the outcome once the pairing is settled either way, null for a stray request. */
    private fun answer(context: Context, socket: Socket, state: String, email: String, cookie: String): Outcome? {
        socket.soTimeout = 10_000
        val line = try {
            socket.getInputStream().bufferedReader().readLine()
        } catch (_: IOException) {
            null
        } ?: return null
        val target = line.split(" ").getOrNull(1) ?: return null
        val u = Uri.parse("http://127.0.0.1$target")
        if (u.path != RETURN_PATH || u.getQueryParameter("state") != state) {
            reply(socket, 404, "Not found")
            return null
        }
        // The browser may be signed in to the origin as someone else: their token must not sync this account.
        val identity = u.getQueryParameter("identity")
        if (identity != email) {
            Log.w(TAG, "sync pairing refused: the browser is signed in as $identity, not $email")
            reply(socket, 409, "This browser is signed in to $SYNC_HOST as another account than the phone's, so nothing was paired. Go back to k7: it says what to do.")
            return Outcome.OtherAccount(identity)
        }
        val url = u.getQueryParameter("url").orEmpty()
        val token = u.getQueryParameter("token").orEmpty()
        val stored = local("PUT", "/api/sync/remote", cookie, JSONObject().put("url", url).put("token", token))
        // The same token lists this phone's engine at that studio, which may admit paired machines only.
        if (stored != null) SupervisorHost.rememberDeviceToken(context, originOf(url), token)
        reply(socket, if (stored != null) 200 else 500, if (stored != null) "This phone now syncs your workspaces. You can go back to k7." else "The pairing could not be stored on this phone. Go back to k7.")
        Log.i(TAG, if (stored != null) "sync paired with $SYNC_ORIGIN" else "sync pairing could not be stored")
        return if (stored != null) Outcome.Paired else Outcome.NotStored
    }

    private fun report(context: Context, outcome: Outcome, email: String) {
        when (outcome) {
            Outcome.Paired -> tell(context, "This phone now syncs its workspaces with $SYNC_HOST.")
            Outcome.NotStored -> tell(context, "The sync pairing could not be saved on this phone. k7 will offer it again at its next start.")
            is Outcome.OtherAccount -> {
                val who = outcome.browserAs?.takeIf { it.isNotEmpty() }?.let { "as $it" } ?: "as another account"
                retry = ask(
                    context,
                    "Nothing was paired: the browser is signed in to $SYNC_HOST $who, and this phone is signed in as $email.\n\n" +
                        "Sign in to $SYNC_HOST in the browser as $email, then try again.",
                    "Try again",
                )
            }
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

    private fun pending(context: Context): Pending? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val email = prefs.getString("email", null) ?: return null
        val state = prefs.getString("state", null) ?: return null
        return Pending(email, state, prefs.getInt("port", 0), prefs.getLong("until", 0)).takeIf { it.port > 0 }
    }

    // Written before the browser opens, synchronously: the process may be killed as soon as it is behind.
    private fun remember(context: Context, p: Pending) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("email", p.email).putString("state", p.state).putInt("port", p.port).putLong("until", p.until)
            .commit()
    }

    private fun forget(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    /** `wss://host/api/sync` as the studio's origin, `https://host`: the key the supervisor's registry list uses. */
    private fun originOf(relay: String): String {
        val u = runCatching { Uri.parse(relay) }.getOrNull() ?: return ""
        val scheme = if (u.scheme == "ws") "http" else "https"
        val host = u.host ?: return ""
        return if (u.port > 0) "$scheme://$host:${u.port}" else "$scheme://$host"
    }

    private fun reply(socket: Socket, status: Int, said: String) {
        val body = ("<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\">" +
            "<title>k7</title><body style=\"font:16px system-ui;background:#101114;color:#e4e4e7;padding:24px\"><p>" +
            said.replace("&", "&amp;").replace("<", "&lt;") + "</p>").toByteArray()
        val head = "HTTP/1.1 $status ${if (status == 200) "OK" else "Error"}\r\n" +
            "Content-Type: text/html; charset=utf-8\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n"
        socket.getOutputStream().apply {
            write(head.toByteArray())
            write(body)
            flush()
        }
    }

    /** The phone's backend, as the signed-in account: its session cookie, read from the views' CookieManager. */
    private fun local(method: String, path: String, cookie: String, body: JSONObject? = null): JSONObject? {
        val c = URL(BackendHost.ORIGIN + path).openConnection() as HttpURLConnection
        return try {
            c.requestMethod = method
            c.connectTimeout = 5_000
            // A PUT restarts the account's file service before it answers.
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
