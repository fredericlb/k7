// The app module. Neither native program is built by AGP's externalNativeBuild: that would configure
// second CMake trees and fetch Tracktion into one. Each `android-arm64` preset builds where every other
// preset does, against the SDK's NDK, and the results are staged here: the engine as the JNI library it
// is, the supervisor as an EXECUTABLE named like one, since only lib*.so files reach the native library
// directory — the one place Android lets an app run its own binary.

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "se.frediver.st0"
    compileSdk = 36
    ndkVersion = "29.0.14206865"

    defaultConfig {
        applicationId = "se.frediver.st0"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.0.1"
        ndk { abiFilters += "arm64-v8a" }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets["main"].jniLibs.srcDir(layout.buildDirectory.dir("engine-jni"))

    // Extracted to disk at install rather than mapped from the APK: an executable must be a real file.
    packaging { jniLibs { useLegacyPackaging = true } }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

val engineDir = rootDir.resolve("../st0-engine")
val supervisorDir = rootDir.resolve("../st0-supervisor")

// The preset, with this SDK's NDK, through the same script as build:mac and build:win.
val buildEngine by tasks.registering(Exec::class) {
    workingDir = engineDir
    environment("ANDROID_NDK_HOME", android.ndkDirectory.absolutePath)
    commandLine("node", "scripts/build.mjs", "android-arm64")
}

// The supervisor through supervisorBuild.mjs, the tray's own entry, told which preset to use.
val buildSupervisor by tasks.registering(Exec::class) {
    workingDir = rootDir.resolve("../..")
    environment("ANDROID_NDK_HOME", android.ndkDirectory.absolutePath)
    environment("STUDIO_SUPERVISOR_PRESET", "android-arm64")
    commandLine(
        "node", "-e",
        "import('./engine/st0-tray/scripts/supervisorBuild.mjs').then((m) => m.buildSupervisor(process.cwd()))",
    )
}

val stageEngine by tasks.registering(Copy::class) {
    dependsOn(buildEngine, buildSupervisor)
    from(engineDir.resolve("build/android-arm64/libst0engine.so"))
    from(supervisorDir.resolve("build/android-arm64/st0-supervisor")) { rename { "libst0supervisor.so" } }
    into(layout.buildDirectory.dir("engine-jni/arm64-v8a"))
}

// Faust's standard libraries, which `import("stdfaust.lib")` resolves at RUNTIME: from wherever the
// engine's CMake fetched them — its cache names the folder — into the APK's assets. The app unpacks them.
val faustLibsOut = layout.buildDirectory.dir("engine-assets/faust-libs")

// The folder is found when the task RUNS: the cache naming it is written by buildEngine, and a Copy's
// source is resolved while Gradle plans the build, before a fresh checkout has any cache to read.
val stageFaustLibs by tasks.registering {
    dependsOn(buildEngine)
    outputs.dir(faustLibsOut)
    doLast {
        val cache = engineDir.resolve("build/android-arm64/CMakeCache.txt").readLines()
        val dir = cache.firstOrNull { it.startsWith("STUDIO_FAUST_LIBS:") }?.substringAfter("=")
        val folder = dir?.let(::File)
        require(folder != null && folder.resolve("stdfaust.lib").isFile) {
            "no Faust libraries at '$dir' — the faustlibraries submodule was not fetched with the engine"
        }
        val out = faustLibsOut.get().asFile
        out.deleteRecursively()
        out.mkdirs()
        folder.listFiles { f -> f.name.endsWith(".lib") }.orEmpty().forEach { it.copyTo(out.resolve(it.name)) }
    }
}

android.sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("engine-assets"))

tasks.named("preBuild") { dependsOn(stageEngine, stageFaustLibs) }
