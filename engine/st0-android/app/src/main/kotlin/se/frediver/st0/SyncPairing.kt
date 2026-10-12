// SyncPairing.kt — pair the account signed in on the phone's own studio with the ORIGIN's relay, once, through
// the system browser: the origin mints a device token and redirects it to a loopback port this process listens
// on, and the phone's backend keeps it for that account. Mirrors apps/st0-standalone/src/pairSync.ts.
// The listener lives in this process: one killed while the browser is in front loses the answer. See docs/android.md.

package se.frediver.st0

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URL
import java.security.SecureRandom

object SyncPairing {
    /** web-protocol's STUDIO_ORIGIN: the one origin a phone's workspaces and libraries follow. */
    private const val SYNC_ORIGIN = "https://st0.app"
    /** web-protocol's SYNC_PAIR_ROUTE and SYNC_PAIR_RETURN_PATH: the origin accepts only an http loopback return. */
    private const val PAIR_ROUTE = "/api/sync/devices/pair"
    private const val RETURN_PATH = "/desktop/sync-pair"
    /** A pairing left unfinished in the browser stops listening after this. */
    private const val WAIT_MS = 10 * 60_000L
    private const val TAG = "st0-sync"

    // Accounts asked this run: a pairing the person closed is not reopened at every page load.
    private val asked = mutableSetOf<String>()
    private var busy = false

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
        }, "st0-sync-pair").start()
    }

    private fun run(context: Context, cookie: String) {
        val user = local("GET", "/auth/me", cookie)?.optJSONObject("user") ?: return
        val email = user.optString("email").takeIf { it.isNotEmpty() } ?: return
        if (user.optBoolean("local") || synchronized(this) { email in asked }) return
        val remote = local("GET", "/api/sync/remote", cookie) ?: return
        if (remote.optBoolean("paired")) return
        synchronized(this) { asked.add(email) }
        val state = ByteArray(16).also { SecureRandom().nextBytes(it) }
            .let { Base64.encodeToString(it, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP) }
        ServerSocket(0, 4, InetAddress.getByName("127.0.0.1")).use { server ->
            val back = "http://127.0.0.1:${server.localPort}$RETURN_PATH"
            val url = Uri.parse(SYNC_ORIGIN + PAIR_ROUTE).buildUpon()
                .appendQueryParameter("return", back)
                .appendQueryParameter("state", state)
                .appendQueryParameter("name", deviceName())
                .build()
            try {
                context.startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (_: ActivityNotFoundException) {
                return
            }
            val end = System.currentTimeMillis() + WAIT_MS
            while (true) {
                val left = end - System.currentTimeMillis()
                if (left <= 0) return
                server.soTimeout = left.toInt()
                val socket = try {
                    server.accept()
                } catch (_: SocketTimeoutException) {
                    return
                }
                if (socket.use { answer(it, state, email, cookie) }) return
            }
        }
    }

    /** One request on the listener; true once the pairing is settled either way, false for a stray request. */
    private fun answer(socket: Socket, state: String, email: String, cookie: String): Boolean {
        socket.soTimeout = 10_000
        val line = try {
            socket.getInputStream().bufferedReader().readLine()
        } catch (_: IOException) {
            null
        } ?: return false
        val target = line.split(" ").getOrNull(1) ?: return false
        val u = Uri.parse("http://127.0.0.1$target")
        if (u.path != RETURN_PATH || u.getQueryParameter("state") != state) {
            reply(socket, 404, "Not found")
            return false
        }
        // The browser may be signed in to the origin as someone else: their token must not sync this account.
        if (u.getQueryParameter("identity") != email) {
            Log.w(TAG, "sync pairing refused: the browser is signed in as ${u.getQueryParameter("identity")}, not $email")
            reply(socket, 409, "The browser is signed in to st0 as another account. Sign in there as $email and try again.")
            return true
        }
        val url = u.getQueryParameter("url").orEmpty()
        val token = u.getQueryParameter("token").orEmpty()
        val stored = local("PUT", "/api/sync/remote", cookie, JSONObject().put("url", url).put("token", token))
        reply(socket, if (stored != null) 200 else 500, if (stored != null) "This phone now syncs your workspaces. You can go back to st0." else "The pairing could not be stored on this phone.")
        Log.i(TAG, if (stored != null) "sync paired with $SYNC_ORIGIN" else "sync pairing could not be stored")
        return true
    }

    private fun reply(socket: Socket, status: Int, said: String) {
        val body = ("<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\">" +
            "<title>st0</title><body style=\"font:16px system-ui;background:#101114;color:#e4e4e7;padding:24px\"><p>" +
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
