// MediaPlaybackService.kt — the one service the app has: in the foreground while a page PLAYS, so the screen can go off
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
        // Detached first, so stopping leaves the paused notification up instead of taking it down.
        if (intent?.action == PAUSED) {
            stopForeground(STOP_FOREGROUND_DETACH)
            stopSelf()
            return START_NOT_STICKY
        }
        val shown = MediaPlayback.notification
        if (shown == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        startForeground(MediaPlayback.NOTIFICATION_ID, shown, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        return START_NOT_STICKY
    }

    // The app swiped away is the app quit, as leaving MainActivity is: the controls go with it.
    override fun onTaskRemoved(rootIntent: Intent?) {
        MediaPlayback.clear(this)
        stopSelf()
    }

    companion object {
        private const val TAG = "k7-media"
        private const val PAUSED = "se.frediver.k7.PAUSED"
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
            if (keep) runCatching { context.startService(intent.setAction(PAUSED)) }.onFailure { context.stopService(intent) }
            else context.stopService(intent)
        }
    }
}
