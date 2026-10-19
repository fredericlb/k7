// AuthService.kt — the app held in the foreground while the browser signs in, so its backend keeps the network.
// Android 15 cuts a backgrounded app off the network, and the backend trades the code with the identity
// provider while the browser is in front: without this, DNS fails and the sign-in with it. See docs/android.md.

package se.frediver.k7

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

class AuthService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        // A short service: Android ends it on its own after a few minutes, which is the bound a sign-in deserves.
        runCatching { startForeground(ID, notification(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE) }
            .onFailure {
                Log.w(TAG, "no foreground for the sign-in: ${it.message}")
                stopSelf()
            }
        return START_NOT_STICKY
    }

    override fun onTimeout(startId: Int) = stopSelf()

    companion object {
        private const val TAG = "k7-auth"
        private const val ID = 3
        private const val CHANNEL = "auth"
        private const val STOP = "se.frediver.k7.AUTH_STOP"

        /** Before the browser opens, while the app is still in front: a foreground service may not start from behind. */
        fun hold(context: Context) {
            if (Build.VERSION.SDK_INT < 34) return
            runCatching { context.startForegroundService(Intent(context, AuthService::class.java)) }
                .onFailure { Log.w(TAG, "no foreground for the sign-in: ${it.message}") }
        }

        /** The browser answered, or gave up: the app is in front again and needs no holding. */
        fun release(context: Context) {
            if (Build.VERSION.SDK_INT < 34) return
            val intent = Intent(context, AuthService::class.java).setAction(STOP)
            runCatching { context.startService(intent) }
        }

        private fun notification(context: Context): Notification {
            val nm = context.getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CHANNEL) == null)
                nm.createNotificationChannel(NotificationChannel(CHANNEL, "Signing in", NotificationManager.IMPORTANCE_LOW))
            return Notification.Builder(context, CHANNEL)
                .setSmallIcon(context.applicationInfo.icon)
                .setContentTitle("Signing in…")
                .setOngoing(true)
                .build()
        }
    }
}
