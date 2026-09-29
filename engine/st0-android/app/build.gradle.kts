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

    // 21: Capacitor's runtime is built for it, and the app's own Java and Kotlin must agree with each other.
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    sourceSets["main"].jniLibs.srcDir(layout.buildDirectory.dir("engine-jni"))

    // Extracted to disk at install rather than mapped from the APK: an executable must be a real file.
    packaging { jniLibs { useLegacyPackaging = true } }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21) }
}

// The versions Capacitor's own module is built against (its build.gradle's defaults), for what the app
// uses of them directly: BridgeActivity is an AppCompatActivity, AppViewsPlugin draws under the insets, and
// StudioBridge talks to the apps' pages through androidx.webkit's WebMessageListener.
dependencies {
    implementation(project(":capacitor-android"))
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity:1.11.0")
    implementation("androidx.core:core:1.17.0")
    implementation("androidx.coordinatorlayout:coordinatorlayout:1.3.0")
    implementation("androidx.webkit:webkit:1.14.0")
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

// The page (web/: the engine tray, shown while no studio is connected), built by its workspace and staged the way `cap copy` would
// lay it out: the bundle under public/, beside the config Capacitor reads at start and the list of npm
// plugins it would load — none, since the app's two plugins are registered by MainActivity itself.
val webDir = rootDir.resolve("web")
val shellOut = layout.buildDirectory.dir("shell-assets")

val buildShell by tasks.registering(Exec::class) {
    workingDir = webDir
    inputs.files(fileTree(webDir.resolve("src")), webDir.resolve("index.html"), webDir.resolve("vite.config.ts"), webDir.resolve("package.json"))
    outputs.dir(webDir.resolve("dist"))
    commandLine("npm", "run", "build")
}

val stageShell by tasks.registering(Sync::class) {
    dependsOn(buildShell)
    from(webDir.resolve("dist")) { into("public") }
    from(webDir.resolve("capacitor.config.json"))
    from(resources.text.fromString("[]")) { rename { "capacitor.plugins.json" } }
    into(shellOut)
}

android.sourceSets["main"].assets.srcDir(shellOut)

tasks.named("preBuild") { dependsOn(stageEngine, stageFaustLibs, stageShell) }
