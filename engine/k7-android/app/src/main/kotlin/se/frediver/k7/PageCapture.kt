// PageCapture.kt — a studio app's getUserMedia, answered: the microphone and the camera, to the studio's own apps only,
// each asked on first need (DeviceAccess). A request is granted WHOLE or denied: the WebView turns a grant of part of
// what was asked into a denial, so a page asking for both gets both or neither. See docs/android.md.

package se.frediver.k7

import android.webkit.PermissionRequest

object PageCapture {
    private val BY_RESOURCE = mapOf(
        PermissionRequest.RESOURCE_AUDIO_CAPTURE to Device.MIC,
        PermissionRequest.RESOURCE_VIDEO_CAPTURE to Device.CAMERA,
    )

    /** The devices a request needs, or null when it is refused outright: another origin's page, or anything beyond these two. */
    fun devices(resources: Array<String>, ownApp: Boolean): List<Device>? {
        if (!ownApp || resources.isEmpty()) return null
        return resources.map { BY_RESOURCE[it] ?: return null }.distinct()
    }

    /** Each device asked in turn, on the main thread; the first refused denies the request, and a blocked one is told to the pages. */
    fun answer(request: PermissionRequest, devices: List<Device>, access: (Device) -> DeviceAccess?, onBlocked: (Device) -> Unit) {
        val next = devices.firstOrNull() ?: return request.grant(request.resources)
        val asker = access(next) ?: return request.deny()
        asker.request { answer ->
            if (answer == DeviceAccess.Answer.GRANTED) return@request answer(request, devices.drop(1), access, onBlocked)
            request.deny()
            if (answer == DeviceAccess.Answer.BLOCKED) onBlocked(next)
        }
    }
}
