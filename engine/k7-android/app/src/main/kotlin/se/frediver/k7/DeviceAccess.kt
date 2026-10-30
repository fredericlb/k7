// DeviceAccess.kt — RECORD_AUDIO or CAMERA, asked when something first needs it: a page's getUserMedia (PageCapture) or,
// for the microphone, a track armed on the engine (Busy). Never at start: a refusal then costs that device and nothing else.
// A permission the user blocked is not asked again; the dialog sends them to the app's settings instead. The engine opens
// its inputs once per process (EngineBridge), so a microphone granted after it started reaches it at the next start.
// One class for both devices, since only the wording and that restart differ. See docs/android.md.

package se.frediver.k7

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/** A device a page or the engine may ask for, with what the person is told about it. */
enum class Device(val permission: String, val title: String, val rationale: String, val blocked: String, val event: String) {
    MIC(
        Manifest.permission.RECORD_AUDIO,
        "Microphone",
        "k7 needs the microphone to record and to monitor inputs.",
        "The microphone is turned off for k7, so it cannot record or monitor inputs. Allow it in k7's settings.",
        "k7:mic-denied",
    ),
    CAMERA(
        Manifest.permission.CAMERA,
        "Camera",
        "k7 needs the camera to record a picture lane and to show a webcam.",
        "The camera is turned off for k7, so it cannot record or show a picture from it. Allow it in k7's settings.",
        "k7:camera-denied",
    ),
}

class DeviceAccess(private val activity: AppCompatActivity, private val device: Device) {
    enum class Answer { GRANTED, DENIED, BLOCKED }

    // Everyone who asked while one question was on screen gets its answer.
    private val waiting = mutableListOf<(Answer) -> Unit>()
    private var asking = false
    private var dialogUp = false
    private var restartHinted = false
    private val launcher = activity.activityResultRegistry.register("k7-${device.name.lowercase()}", ActivityResultContracts.RequestPermission()) { granted ->
        when {
            granted -> settle(Answer.GRANTED, fresh = true)
            // Refused with no rationale left to show: blocked for good, the system will not ask again.
            !activity.shouldShowRequestPermissionRationale(device.permission) -> blocked()
            else -> settle(Answer.DENIED)
        }
    }

    fun granted() = activity.checkSelfPermission(device.permission) == PackageManager.PERMISSION_GRANTED

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
        if (activity.shouldShowRequestPermissionRationale(device.permission)) {
            show(
                device.rationale,
                "Continue",
                onYes = { launcher.launch(device.permission) },
                onNo = { settle(Answer.DENIED) },
            )
        } else {
            launcher.launch(device.permission)
        }
    }

    private fun blocked() {
        settle(Answer.BLOCKED)
        show(
            device.blocked,
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

    // The engine opened its device without inputs: only a new process gives it them, and a restart is the way there.
    private fun hintRestart() {
        if (device != Device.MIC || restartHinted || EngineBridge.startedWithMic != false) return
        restartHinted = true
        if (Busy.busy) {
            android.widget.Toast.makeText(activity, "The engine's inputs come with k7's next start.", android.widget.Toast.LENGTH_LONG).show()
            return
        }
        show(
            "The microphone is allowed. The engine started without its inputs, and gets them the next time k7 starts.",
            "Restart k7",
            onYes = { Relaunch.restart(activity) },
            onNo = {},
            no = "Later",
        )
    }

    private fun show(message: String, yes: String, onYes: () -> Unit, onNo: () -> Unit, no: String = "Not now") {
        if (activity.isFinishing || dialogUp) return onNo()
        dialogUp = true
        var said = false
        AlertDialog.Builder(activity)
            .setTitle(device.title)
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
