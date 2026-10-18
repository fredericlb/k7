// UpdateCheckTest.kt — the channel a stamp follows, what counts as newer on each, and which file is the APK.

package se.frediver.k7

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateCheckTest {
    @Test
    fun readsTheTwoCiStampsAndNothingElse() {
        assertEquals("release", UpdateCheck.channelOf("v0.1.0"))
        assertEquals("snapshot", UpdateCheck.channelOf("snapshot-9f2c1ab"))
        assertNull(UpdateCheck.channelOf(""))
        assertNull(UpdateCheck.channelOf("0.1.0"))
        assertNull(UpdateCheck.channelOf("snapshot-xyz"))
    }

    @Test
    fun comparesReleasesByNumber() {
        assertTrue(UpdateCheck.isNewer("v1.9.0", "v1.10.0"))
        assertTrue(UpdateCheck.isNewer("v1.4.0", "v2.0.0"))
        assertFalse(UpdateCheck.isNewer("v1.10.0", "v1.9.0"))
        assertFalse(UpdateCheck.isNewer("v1.4.0", "v1.4.0"))
    }

    @Test
    fun takesAnotherSnapshotCommitAsLater() {
        assertTrue(UpdateCheck.isNewer("snapshot-fedcba9", "snapshot-0123456"))
        assertFalse(UpdateCheck.isNewer("snapshot-0123456", "snapshot-0123456"))
    }

    @Test
    fun neverCrossesChannelsNorUpdatesAnUnstampedBuild() {
        assertFalse(UpdateCheck.isNewer("snapshot-fedcba9", "v9.0.0"))
        assertFalse(UpdateCheck.isNewer("v0.1.0", "snapshot-0123456"))
        assertFalse(UpdateCheck.isNewer("", "v9.0.0"))
        assertFalse(UpdateCheck.isNewer("v0.1.0", "garbage"))
    }

    @Test
    fun findsTheApkAmongABuildsFiles() {
        val files = listOf("SHA256SUMS", "k7_v0.1.0_windows-x64.exe", "k7-android_v0.1.0_arm64.apk", "latest.yml")
        assertEquals("k7-android_v0.1.0_arm64.apk", UpdateCheck.apkOf(files))
        assertNull(UpdateCheck.apkOf(listOf("k7_v0.1.0_windows-x64.exe")))
        assertNull(UpdateCheck.apkOf(listOf("../k7-android_x.apk")))
    }

    @Test
    fun labelsAReleaseByItsNumber() {
        assertEquals("0.1.0", UpdateCheck.label("v0.1.0"))
        assertEquals("snapshot-9f2c1ab", UpdateCheck.label("snapshot-9f2c1ab"))
    }
}
