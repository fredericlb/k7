// EngineService.kt — the foreground service held while the app is BUSY (Busy.kt): the engine playing, armed or recording,
// a page holding the microphone. Without it Android freezes a process whose activity is behind, and cuts its microphone.
// It shows one notification and does nothing else. The microphone type is only granted while the app is in front
// (Android 14), so a start that is refused it falls back to mediaPlayback alone. See docs/android.md.

package se.frediver.k7

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

class EngineService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        val shown = notification(this, intent?.getStringExtra(LABEL) ?: "k7")
        val media = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
        val wanted = if (intent?.getBooleanExtra(MIC, false) == true && Build.VERSION.SDK_INT >= 30)
            media or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else media
        // Every start enters the foreground: a startForegroundService left without its startForeground crashes the app.
        runCatching { startForeground(ID, shown, wanted) }
            .recoverCatching {
                if (wanted == media) throw it
                Log.w(TAG, "no microphone foreground, media only: ${it.message}")
                startForeground(ID, shown, media)
            }
            .onFailure {
                Log.w(TAG, "no foreground: ${it.message}")
                stopSelf()
            }
        return START_NOT_STICKY
    }

    // The app swiped away is the app quit: nothing is left to keep in front.
    override fun onTaskRemoved(rootIntent: Intent?) = stopSelf()

    companion object {
        private const val TAG = "k7-busy"
        private const val ID = 2
        private const val CHANNEL = "engine"
        private const val STOP = "se.frediver.k7.ENGINE_STOP"
        private const val LABEL = "label"
        private const val MIC = "mic"
        private var held = false
        private var last: Pair<String, Boolean>? = null

        /** Into the foreground, or its notification updated; a first start refused from behind (Android 12+) is only logged. */
        fun hold(context: Context, label: String, mic: Boolean) {
            if (held && last == label to mic) return
            val intent = Intent(context, EngineService::class.java).putExtra(LABEL, label).putExtra(MIC, mic)
            // Once in front, a plain start delivers the update: the app counts as foreground while it holds the service.
            runCatching { if (held) context.startService(intent) else context.startForegroundService(intent) }
                .onSuccess {
                    held = true
                    last = label to mic
                }
                .onFailure { Log.w(TAG, "no foreground: ${it.message}") }
        }

        fun release(context: Context) {
            if (!held) return
            held = false
            last = null
            val intent = Intent(context, EngineService::class.java)
            runCatching { context.startService(intent.setAction(STOP)) }.onFailure { context.stopService(intent) }
        }

        private fun notification(context: Context, label: String): Notification {
            val nm = context.getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CHANNEL) == null)
                nm.createNotificationChannel(NotificationChannel(CHANNEL, "Engine at work", NotificationManager.IMPORTANCE_LOW))
            val open = PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            return Notification.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_media)
                .setContentTitle("k7")
                .setContentText(label)
                .setContentIntent(open)
                .setOngoing(true)
                .build()
        }
    }
}
