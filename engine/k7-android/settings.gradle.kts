// The Android shell around k7-runtime: one app module, the engine itself built by CMake from ../k7-runtime
// (app/build.gradle.kts), and Capacitor's runtime for the page in web/. See docs/android.md.

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    // PREFER, not FAIL_ON: Capacitor's own module declares repositories of its own, the same two.
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "k7-android"
include(":app")

// Capacitor's Android runtime, from the workspace install (web/ is an npm workspace, hoisted to the repo
// root) — what `cap sync` would write into a capacitor.settings.gradle. There is no `cap sync` here: web/
// is staged by app/build.gradle.kts like the engine is, and this is the one line it would contribute.
include(":capacitor-android")
project(":capacitor-android").projectDir = rootDir.resolve("../../node_modules/@capacitor/android/capacitor")
