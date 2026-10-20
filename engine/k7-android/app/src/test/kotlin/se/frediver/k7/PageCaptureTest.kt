// PageCaptureTest.kt — which devices a page's capture request needs, and which requests are refused before anything is asked.

package se.frediver.k7

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PageCaptureTest {
    private val audio = "android.webkit.resource.AUDIO_CAPTURE"
    private val video = "android.webkit.resource.VIDEO_CAPTURE"

    @Test
    fun mapsEachResourceToItsDevice() {
        assertEquals(listOf(Device.MIC), PageCapture.devices(arrayOf(audio), ownApp = true))
        assertEquals(listOf(Device.CAMERA), PageCapture.devices(arrayOf(video), ownApp = true))
    }

    @Test
    fun asksBothForARequestOfBoth() {
        assertEquals(listOf(Device.MIC, Device.CAMERA), PageCapture.devices(arrayOf(audio, video), ownApp = true))
        assertEquals(listOf(Device.CAMERA), PageCapture.devices(arrayOf(video, video), ownApp = true))
    }

    @Test
    fun refusesAnotherOriginsPage() {
        assertNull(PageCapture.devices(arrayOf(audio), ownApp = false))
        assertNull(PageCapture.devices(arrayOf(video), ownApp = false))
    }

    @Test
    fun refusesAnythingBeyondTheTwoDevices() {
        assertNull(PageCapture.devices(arrayOf("android.webkit.resource.PROTECTED_MEDIA_ID"), ownApp = true))
        assertNull(PageCapture.devices(arrayOf(video, "android.webkit.resource.MIDI_SYSEX"), ownApp = true))
        assertNull(PageCapture.devices(emptyArray(), ownApp = true))
    }

    @Test
    fun namesThePermissionAndThePageEvent() {
        assertEquals("android.permission.RECORD_AUDIO", Device.MIC.permission)
        assertEquals("android.permission.CAMERA", Device.CAMERA.permission)
        assertEquals("k7:mic-denied", Device.MIC.event)
        assertEquals("k7:camera-denied", Device.CAMERA.event)
    }
}
