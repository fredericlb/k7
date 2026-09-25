// The Android shell around st0-engine: one app module, and the engine itself built by CMake from
// ../st0-engine (app/build.gradle.kts). See docs/android.md.

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "st0-android"
include(":app")
