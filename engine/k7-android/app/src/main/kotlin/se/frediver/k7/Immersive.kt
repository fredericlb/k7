// Immersive.kt — full screen: the status and navigation bars hidden, a swipe from an edge showing them for a moment.
// A setting of this device, set from k7's Engine page (StudioBridge's `setImmersive`), kept in the app's own
// preferences rather than the account's, since a tablet left on one app and the phone in a pocket want different answers.
// Applied in onCreate, before any page loads, and again whenever the window takes focus back from a dialog.
// See docs/android.md.

package se.frediver.k7

import android.app.Activity
import android.content.Context
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

object Immersive {
    private const val PREFS = "k7-display"
    private const val KEY = "immersive"

    fun isOn(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false)

    /** Remembers `on` for the next start too, and applies it now. */
    fun set(activity: Activity, on: Boolean) {
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, on).apply()
        activity.runOnUiThread { apply(activity) }
    }

    fun apply(activity: Activity) {
        val bars = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
        if (isOn(activity)) {
            bars.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            bars.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            bars.show(WindowInsetsCompat.Type.systemBars())
        }
    }
}
