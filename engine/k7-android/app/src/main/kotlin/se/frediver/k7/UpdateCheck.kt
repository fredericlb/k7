// UpdateCheck.kt — what Updates.kt decides without Android: the channel a stamp follows, whether the build k7.rocks serves
// is newer, and which of its files is the APK. Mirrors packages/app-updates/src/updateCheck.ts; tested on the JVM.

package se.frediver.k7

object UpdateCheck {
    /** Where desktop.yml publishes every build (docs/app-downloads.md at the root). */
    const val DOWNLOADS = "https://k7.rocks/app_downloads"

    private val RELEASE = Regex("""v(\d+)\.(\d+)\.(\d+)""")
    private val SNAPSHOT = Regex("""snapshot-[0-9a-f]{7,40}""")
    // The phone's file, as desktop.yml names it: `k7-android_<stamp>_arm64.apk`.
    private val APK = Regex("""k7-android_[A-Za-z0-9._-]+\.apk""")

    /** `release` or `snapshot`, or null for a build CI did not stamp (a checkout's, the e2e one). */
    fun channelOf(stamp: String): String? = when {
        RELEASE.matches(stamp) -> "release"
        SNAPSHOT.matches(stamp) -> "snapshot"
        else -> null
    }

    /** Whether `served` is a later build than `stamp` on the same channel. */
    fun isNewer(stamp: String, served: String): Boolean {
        val channel = channelOf(stamp) ?: return false
        if (channelOf(served) != channel) return false
        // The snapshot channel only ever holds main's latest build, so another commit is a later one.
        if (channel == "snapshot") return served != stamp
        val a = RELEASE.matchEntire(stamp)!!.groupValues.drop(1).map(String::toInt)
        val b = RELEASE.matchEntire(served)!!.groupValues.drop(1).map(String::toInt)
        return a.zip(b).firstOrNull { (x, y) -> x != y }?.let { (x, y) -> y > x } ?: false
    }

    /** The APK among a build's files, or null when the build carries none (a snapshot made without the release key). */
    fun apkOf(files: List<String>): String? = files.firstOrNull(APK::matches)

    /** What a build is called to the person: `0.2.0` for a release, its stamp for a snapshot. */
    fun label(stamp: String): String = if (RELEASE.matches(stamp)) stamp.drop(1) else stamp
}
