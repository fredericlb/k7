// AuthHandoff.kt — sign in to the studio in the SYSTEM browser and carry the session back into the app's views.
// Identity providers refuse a WebView, and RFC 8252 says why they should. Mirrors packages/web-protocol/handoff.ts; see docs/android.md.

package se.frediver.k7

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom

object AuthHandoff {
    /** The app's own scheme, in the manifest's intent filter too; the server sends the code nowhere else but loopback. */
    const val SCHEME = "se.frediver.k7"
    private const val HOST = "auth"
    private const val ISSUE = "/auth/handoff/issue"
    private const val REDEEM = "/auth/handoff/redeem"
    // Kept on disk: the process may be killed while the browser is in front.
    private const val PREFS = "k7-auth-handoff"

    private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

    private fun random() = ByteArray(32).also { SecureRandom().nextBytes(it) }.let(::b64)

    /** Open the browser on the studio's sign-in; its answer comes back as an intent to `MainActivity`. */
    fun start(context: Context, studio: String) {
        val verifier = random()
        val state = random()
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("verifier", verifier).putString("state", state).putString("studio", studio).apply()
        val challenge = b64(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))
        val url = Uri.parse(studio).buildUpon().path(ISSUE)
            .appendQueryParameter("redirect", "$SCHEME://$HOST")
            .appendQueryParameter("challenge", challenge)
            .appendQueryParameter("state", state)
            .build()
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
            // No browser at all: nothing to sign in with.
        }
    }

    /** The address that turns the browser's answer into a session in a view, or null when it is not ours. */
    fun redeemUrl(context: Context, answer: Uri, returnTo: String): String? {
        if (answer.scheme != SCHEME || answer.host != HOST) return null
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val verifier = prefs.getString("verifier", null) ?: return null
        val studio = prefs.getString("studio", null) ?: return null
        val code = answer.getQueryParameter("code") ?: return null
        if (answer.getQueryParameter("state") != prefs.getString("state", null)) return null
        // One use: a replayed intent finds nothing to redeem with.
        prefs.edit().clear().apply()
        return Uri.parse(studio).buildUpon().path(REDEEM)
            .appendQueryParameter("code", code)
            .appendQueryParameter("verifier", verifier)
            .appendQueryParameter("return_to", returnTo)
            .build().toString()
    }
}
