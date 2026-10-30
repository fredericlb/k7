// Downloads.kt — a file a studio app saves, written into the public Downloads through MediaStore. The bytes are
// fetched INSIDE the page (assets/download.js), since only the page can read a blob: URL or send the session's
// cookie, and they arrive over StudioBridge as base64 chunks, each acknowledged before the next is sent.
// The thing a reader would get wrong: nothing here asks for a storage permission — API 29+ lets an app insert
// into MediaStore.Downloads without one. See docs/android.md.

package se.frediver.k7

import android.content.ContentValues
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.webkit.MimeTypeMap
import android.webkit.URLUtil
import android.webkit.WebView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.OutputStream
import java.util.concurrent.Executors

class Downloads(private val activity: AppCompatActivity) {
    private class Open(val uri: Uri, val out: OutputStream, val name: String)

    // One thread, so the chunks of a file are written in the order they came.
    private val io = Executors.newSingleThreadExecutor { Thread(it, "k7-downloads") }
    private val open = mutableMapOf<String, Open>()

    fun destroy() {
        io.execute { open.keys.toList().forEach { abort(it) } }
        io.shutdown()
    }

    /** One `dl-*` message of the page's: start, chunk, end or fail; every one but `dl-fail` is answered with `dl-ack`. */
    fun onMessage(msg: JSONObject, reply: JavaScriptReplyProxy) {
        val id = msg.optString("id").takeIf { it.isNotEmpty() } ?: return
        if (io.isShutdown) return
        io.execute {
            val ok = runCatching {
                when (msg.optString("t")) {
                    "dl-start" -> begin(id, msg)
                    "dl-chunk" -> open[id]?.out?.write(Base64.decode(msg.getString("data"), Base64.DEFAULT)) ?: error("no download $id")
                    "dl-end" -> finish(id)
                    "dl-fail" -> fail(id, msg.optString("name"), msg.optString("message"))
                    else -> Unit
                }
            }.onFailure {
                Log.w(TAG, "download $id: ${it.message}")
                // The page stops at a refused ack, so this is said once per file.
                fail(id, msg.optString("name"), it.message)
            }.isSuccess
            if (msg.optString("t") != "dl-fail") {
                val ack = JSONObject().put("t", "dl-ack").put("id", id).put("ok", ok).toString()
                activity.runOnUiThread { reply.postMessage(ack) }
            }
        }
    }

    private fun begin(id: String, msg: JSONObject) {
        val mime = msg.optString("type").ifEmpty { "application/octet-stream" }
        val name = fileName(msg.optString("name"), msg.optString("url"), mime)
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val resolver = activity.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("MediaStore refused $name")
        val out = resolver.openOutputStream(uri) ?: run {
            resolver.delete(uri, null, null)
            error("cannot write $name")
        }
        open[id] = Open(uri, out.buffered(), name)
    }

    private fun finish(id: String) {
        val file = open.remove(id) ?: error("no download $id")
        file.out.close()
        val resolver = activity.contentResolver
        resolver.update(file.uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
        // MediaStore renames a clash ("song (1).wav"): the toast says the name it really has.
        val saved = resolver.query(file.uri, arrayOf(MediaStore.Downloads.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        } ?: file.name
        toast("Saved to Downloads: $saved")
    }

    private fun fail(id: String, name: String?, why: String?) {
        val shown = open[id]?.name ?: name?.takeIf { it.isNotEmpty() } ?: "file"
        abort(id)
        toast("Download failed: $shown${why?.takeIf { it.isNotEmpty() }?.let { " ($it)" } ?: ""}")
    }

    private fun abort(id: String) {
        val file = open.remove(id) ?: return
        runCatching { file.out.close() }
        runCatching { activity.contentResolver.delete(file.uri, null, null) }
    }

    private fun toast(text: String) = activity.runOnUiThread { Toast.makeText(activity, text, Toast.LENGTH_LONG).show() }

    companion object {
        private const val TAG = "k7-downloads"

        /** The page's name, made a plain file name; else one guessed from the URL, with the type's extension when it has none. */
        fun fileName(given: String, url: String, mime: String): String {
            val plain = given.substringAfterLast('/').substringAfterLast('\\').filter { it >= ' ' && it !in "<>:\"|?*" }.trim().trimStart('.')
            if (plain.isNotEmpty()) return plain.take(MAX_NAME)
            val guessed = URLUtil.guessFileName(url, null, mime)
            if (guessed.contains('.') || mime.isEmpty()) return guessed
            val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: return guessed
            return "$guessed.$ext"
        }

        private const val MAX_NAME = 200
    }
}

/** Which downloads of a view are fetched by its page (download.js) rather than handed outside, for AppViewsPlugin. */
class DownloadRoutes(
    private val downloadJs: String,
    private val appOf: (Uri) -> String?,
    private val outside: (Uri) -> Unit,
) {
    // Each view's script, injected for its app's origin only and swapped when the studio changes.
    private val scripts = mutableMapOf<String, Pair<String, ScriptHandler>>()

    /** download.js for `id`'s app origin alone: the bridge drops another origin's messages, so its clicks must stay the WebView's. */
    fun inject(id: String, view: WebView, address: Uri) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return
        val origin = "${address.scheme}://${address.host}" + (if (address.port != -1) ":${address.port}" else "")
        if (scripts[id]?.first == origin) return
        scripts.remove(id)?.second?.remove()
        scripts[id] = origin to WebViewCompat.addDocumentStartJavaScript(view, downloadJs, setOf(origin))
    }

    /** `id`'s view destroyed: its script went with it, and the next view needs its own. */
    fun forget(id: String) {
        scripts.remove(id)
    }

    /** What the WebView itself would download: the app's own files are fetched by its page and saved, the rest go outside. */
    fun fromListener(view: WebView, id: String, url: Uri, disposition: String?, mime: String?) {
        val onApp = view.url?.let { appOf(Uri.parse(it)) } == id
        val ours = when (url.scheme?.lowercase()) {
            "data" -> true
            "blob" -> appOf(Uri.parse(url.schemeSpecificPart)) == id
            else -> appOf(url) == id
        }
        if (!onApp || !ours) return outside(url)
        val name = disposition?.let { URLUtil.guessFileName(url.toString(), it, mime) } ?: ""
        val q = JSONObject::quote
        // Run whole, not only called: the document-start copy is missing where that feature is.
        view.evaluateJavascript("$downloadJs\nwindow.__k7Download(${q(url.toString())}, ${q(name)}, ${q(mime ?: "")});", null)
    }
}
