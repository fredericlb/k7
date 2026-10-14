// MediaPlayback.kt — what makes the app a media player to the system: a MediaSession and its notification, filled
// from the page's own Media Session (assets/media-session.js, through StudioBridge's `media`), and the system's
// buttons — lock screen, shade, headset — sent back to the page as `media-action`. It plays nothing: the sound is
// the page's. While it plays, MediaPlaybackService holds the process in the foreground. See docs/android.md.

package se.frediver.st0

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.webkit.JavaScriptReplyProxy
import org.json.JSONObject

object MediaPlayback {
    const val NOTIFICATION_ID = 1
    private const val CHANNEL = "playback"
    private const val TAG = "st0-media"
    private const val ACTION = "se.frediver.st0.MEDIA_ACTION"
    private const val EXTRA = "action"

    private val main = Handler(Looper.getMainLooper())
    private var session: MediaSession? = null
    // The page that last reported, which is the one whose handlers the buttons call.
    private var page: JavaScriptReplyProxy? = null
    private var playing = false

    /** The notification the service shows while it is in the foreground; null with nothing to play. */
    var notification: Notification? = null
        private set

    /** One `media` message from a view; on the main thread, where the WebView delivers it. */
    fun update(context: Context, msg: JSONObject, reply: JavaScriptReplyProxy) {
        val app = context.applicationContext
        val title = msg.optString("title")
        val state = msg.optString("state")
        if (title.isEmpty() || state == "none") {
            if (reply == page || page == null) clear(app)
            return
        }
        page = reply
        val actions = msg.optJSONArray("actions")?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() } ?: emptySet()
        val s = session ?: open(app)
        val artist = msg.optString("artist")
        s.setMetadata(
            MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, msg.optString("album"))
                .putLong(MediaMetadata.METADATA_KEY_DURATION, (msg.optDouble("duration", 0.0) * 1000).toLong())
                .build(),
        )
        playing = state == "playing"
        s.setPlaybackState(
            PlaybackState.Builder()
                .setActions(mask(actions))
                .setState(
                    if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                    (msg.optDouble("position", 0.0) * 1000).toLong(),
                    if (playing) msg.optDouble("rate", 1.0).toFloat() else 0f,
                )
                .build(),
        )
        notification = build(app, s, title, artist, actions)
        if (playing) MediaPlaybackService.hold(app) else MediaPlaybackService.release(app, keep = true)
        app.getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
    }

    /** The page is gone or has closed its player: no session, no notification, no foreground. */
    fun clear(context: Context) {
        val app = context.applicationContext
        page = null
        playing = false
        notification = null
        session?.release()
        session = null
        MediaPlaybackService.release(app, keep = false)
        app.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    }

    private fun open(app: Context): MediaSession = MediaSession(app, "st0").apply {
        setCallback(
            object : MediaSession.Callback() {
                override fun onPlay() = send("play")
                override fun onPause() = send("pause")
                override fun onStop() = send("stop")
                override fun onSeekTo(pos: Long) = send("seekto", pos / 1000.0)
                override fun onSkipToNext() = send("nexttrack")
                override fun onFastForward() = send("seekforward")
                override fun onRewind() = send("seekbackward")
            },
            main,
        )
        setSessionActivity(openApp(app))
        isActive = true
        session = this
    }

    private fun mask(actions: Set<String>): Long {
        var m = PlaybackState.ACTION_PLAY_PAUSE
        if ("play" in actions) m = m or PlaybackState.ACTION_PLAY
        if ("pause" in actions) m = m or PlaybackState.ACTION_PAUSE
        if ("stop" in actions) m = m or PlaybackState.ACTION_STOP
        if ("seekto" in actions) m = m or PlaybackState.ACTION_SEEK_TO
        if ("nexttrack" in actions) m = m or PlaybackState.ACTION_SKIP_TO_NEXT
        if ("seekforward" in actions) m = m or PlaybackState.ACTION_FAST_FORWARD
        if ("seekbackward" in actions) m = m or PlaybackState.ACTION_REWIND
        return m
    }

    /** A system button, to the page's handler of the same name. */
    private fun send(action: String, seekTime: Double? = null) {
        val msg = JSONObject().put("t", "media-action").put("action", action)
        seekTime?.let { msg.put("seekTime", it) }
        main.post {
            runCatching { page?.postMessage(msg.toString()) }.onFailure { Log.w(TAG, "page gone: ${it.message}") }
        }
    }

    // Android 13+ draws its controls from the session; the actions below are what older versions show.
    private fun build(app: Context, s: MediaSession, title: String, artist: String, actions: Set<String>): Notification {
        val nm = app.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Playback", NotificationManager.IMPORTANCE_LOW))
        val shown = mutableListOf<Notification.Action>()
        shown += if (playing) action(app, "pause", android.R.drawable.ic_media_pause, "Pause")
        else action(app, "play", android.R.drawable.ic_media_play, "Play")
        if ("nexttrack" in actions) shown += action(app, "nexttrack", android.R.drawable.ic_media_next, "Next")
        return Notification.Builder(app, CHANNEL)
            .setSmallIcon(R.drawable.ic_media)
            .setContentTitle(title)
            .setContentText(artist)
            .setContentIntent(openApp(app))
            .setDeleteIntent(button(app, "stop"))
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(playing)
            .setActions(*shown.toTypedArray())
            .setStyle(Notification.MediaStyle().setMediaSession(s.sessionToken).setShowActionsInCompactView(*shown.indices.toList().toIntArray()))
            .build()
    }

    private fun action(app: Context, name: String, icon: Int, label: String) =
        Notification.Action.Builder(Icon.createWithResource(app, icon), label, button(app, name)).build()

    private fun button(app: Context, name: String): PendingIntent = PendingIntent.getBroadcast(
        app,
        name.hashCode(),
        Intent(app, Buttons::class.java).setAction(ACTION).putExtra(EXTRA, name),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun openApp(app: Context): PendingIntent = PendingIntent.getActivity(
        app,
        0,
        Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** The notification's own buttons, before Android 13; dismissing it is a `stop`. */
    class Buttons : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != ACTION) return
            intent.getStringExtra(EXTRA)?.let { send(it) }
        }
    }
}
