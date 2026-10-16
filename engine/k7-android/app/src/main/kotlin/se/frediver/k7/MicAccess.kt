// MicAccess.kt — RECORD_AUDIO, asked when something first needs it: a page's getUserMedia (AppViewsPlugin) or a track
// armed on the engine (Busy). Never at start: a refusal then costs the inputs and nothing else. A permission the
// user blocked is not asked again; the dialog sends them to the app's settings instead. The engine opens its inputs
// once per process (EngineBridge), so a grant after it started reaches it at the next start. See docs/android.md.

package se.frediver.k7

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

class MicAccess(private val activity: AppCompatActivity) {
    enum class Answer { GRANTED, DENIED, BLOCKED }

    // Everyone who asked while one question was on screen gets its answer.
    private val waiting = mutableListOf<(Answer) -> Unit>()
    private var asking = false
    private var dialogUp = false
    private var restartHinted = false
    private val launcher = activity.activityResultRegistry.register("k7-mic", ActivityResultContracts.RequestPermission()) { granted ->
        when {
            granted -> settle(Answer.GRANTED, fresh = true)
            // Refused with no rationale left to show: blocked for good, the system will not ask again.
            !activity.shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO) -> blocked()
            else -> settle(Answer.DENIED)
        }
    }

    fun granted() = activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    fun destroy() = launcher.unregister()

    /** Ask, if need be, and answer on the main thread; call it there. */
    fun request(onAnswer: (Answer) -> Unit) {
        if (granted()) {
            onAnswer(Answer.GRANTED)
            hintRestart()
            return
        }
        waiting += onAnswer
        if (asking) return
        asking = true
        if (activity.shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO)) {
            show(
                "k7 needs the microphone to record and to monitor inputs.",
                "Continue",
                onYes = { launcher.launch(Manifest.permission.RECORD_AUDIO) },
                onNo = { settle(Answer.DENIED) },
            )
        } else {
            launcher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    private fun blocked() {
        settle(Answer.BLOCKED)
        show(
            "The microphone is turned off for k7, so it cannot record or monitor inputs. Allow it in k7's settings.",
            "Open settings",
            onYes = {
                val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", activity.packageName, null))
                runCatching { activity.startActivity(intent) }
            },
            onNo = {},
        )
    }

    private fun settle(answer: Answer, fresh: Boolean = false) {
        asking = false
        val all = waiting.toList()
        waiting.clear()
        all.forEach { it(answer) }
        if (fresh) hintRestart()
    }

    // The engine opened its device without inputs: only a new process gives it them, and quitting is the way there.
    private fun hintRestart() {
        if (restartHinted || EngineBridge.startedWithMic != false) return
        restartHinted = true
        if (Busy.busy) {
            android.widget.Toast.makeText(activity, "The engine's inputs come with k7's next start.", android.widget.Toast.LENGTH_LONG).show()
            return
        }
        show(
            "The microphone is allowed. The engine started without its inputs, and gets them the next time k7 starts: quit now, then open k7 again.",
            "Quit k7",
            onYes = { activity.finish() },
            onNo = {},
            no = "Later",
        )
    }

    private fun show(message: String, yes: String, onYes: () -> Unit, onNo: () -> Unit, no: String = "Not now") {
        if (activity.isFinishing || dialogUp) return onNo()
        dialogUp = true
        var said = false
        AlertDialog.Builder(activity)
            .setTitle("Microphone")
            .setMessage(message)
            .setPositiveButton(yes) { _, _ -> said = true }
            .setNegativeButton(no, null)
            .setOnDismissListener {
                dialogUp = false
                if (said) onYes() else onNo()
            }
            .show()
    }
}
