// MediaPlaybackService.kt — the media player's service (EngineService is the other): in the foreground while a page PLAYS, so the screen can go off
// and the app go behind another without Android freezing the process the sound comes from. It shows MediaPlayback's
// notification and does nothing else; paused, it leaves the foreground and the notification stays. See docs/android.md.

package se.frediver.k7

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.util.Log

class MediaPlaybackService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Every start enters the foreground first, even one that only stops: a startForegroundService left unanswered crashes the app.
        val shown = MediaPlayback.notification
        runCatching {
            startForeground(MediaPlayback.NOTIFICATION_ID, shown ?: MediaPlayback.placeholder(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        }.onFailure { Log.w(TAG, "no foreground: ${it.message}") }
        when {
            // Detached, so stopping leaves the paused notification up instead of taking it down.
            intent?.action == PAUSED && shown != null -> leave(STOP_FOREGROUND_DETACH)
            intent?.action == PAUSED || intent?.action == STOP || shown == null -> leave(STOP_FOREGROUND_REMOVE)
        }
        return START_NOT_STICKY
    }

    private fun leave(how: Int) {
        stopForeground(how)
        stopSelf()
    }

    // The app swiped away is the app quit, as leaving MainActivity is: the controls go with it.
    override fun onTaskRemoved(rootIntent: Intent?) {
        MediaPlayback.clear(this)
        stopSelf()
    }

    companion object {
        private const val TAG = "k7-media"
        private const val PAUSED = "se.frediver.k7.PAUSED"
        private const val STOP = "se.frediver.k7.STOP"
        private var held = false

        /** Into the foreground; refused from the background on Android 12+, when the notification alone stays. */
        fun hold(context: Context) {
            if (held) return
            runCatching { context.startForegroundService(Intent(context, MediaPlaybackService::class.java)) }
                .onSuccess { held = true }
                .onFailure { Log.w(TAG, "no foreground: ${it.message}") }
        }

        /** Out of the foreground: `keep` leaves the notification up so play can resume from it. */
        fun release(context: Context, keep: Boolean) {
            if (!held) return
            held = false
            val intent = Intent(context, MediaPlaybackService::class.java)
            // Through onStartCommand rather than stopService, which could end it before its pending startForeground.
            runCatching { context.startService(intent.setAction(if (keep) PAUSED else STOP)) }.onFailure { context.stopService(intent) }
        }
    }
}
