// AccountBar.kt — the bar over the studio apps: the studio's name, who is signed in, and the button that signs in or out.
// Painted in the app's own top colour, like the status bar above it (AppViewsPlugin.paint). See docs/android.md.

package se.frediver.k7

import android.content.Context
import android.graphics.Color
import android.graphics.PorterDuff
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.graphics.ColorUtils

class AccountBar(context: Context, private val onSignIn: () -> Unit, private val onSignOut: () -> Unit) :
    LinearLayout(context) {
    private val title = text(context, 15f).apply { layoutParams = LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f) }
    private val name = text(context, 13f).apply { maxWidth = dp(180) }
    private val button = ImageButton(context).apply {
        setBackgroundColor(Color.TRANSPARENT)
        setPadding(dp(8), dp(8), dp(8), dp(8))
        scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
    }
    private var signedIn = false

    init {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(14), 0, dp(4), 0)
        addView(title)
        addView(name)
        addView(button, LayoutParams(dp(HEIGHT_DP), dp(HEIGHT_DP)))
        button.setOnClickListener { if (signedIn) onSignOut() else onSignIn() }
        show(null)
        paint(Color.TRANSPARENT)
    }

    /** The studio's host, where a desktop window has its title. */
    fun setStudio(host: String?) {
        title.text = host ?: ""
    }

    /** Who `/auth/me` says is signed in; null for nobody. */
    fun show(user: String?) {
        signedIn = user != null
        name.text = user ?: ""
        name.visibility = if (user != null) VISIBLE else GONE
        button.setImageResource(if (signedIn) R.drawable.ic_log_out else R.drawable.ic_log_in)
        button.contentDescription = if (signedIn) "Sign out" else "Sign in"
    }

    /** The app's top colour, and the text and icon that read on it. */
    fun paint(color: Int) {
        setBackgroundColor(color)
        val dark = color == Color.TRANSPARENT || ColorUtils.calculateLuminance(color) < 0.5
        val fg = if (dark) Color.WHITE else Color.BLACK
        title.setTextColor(fg)
        name.setTextColor(ColorUtils.setAlphaComponent(fg, 0xB0))
        button.setColorFilter(fg, PorterDuff.Mode.SRC_IN)
    }

    private fun text(context: Context, sp: Float) = TextView(context).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        maxLines = 1
        ellipsize = TextUtils.TruncateAt.END
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val HEIGHT_DP = 40
    }
}
