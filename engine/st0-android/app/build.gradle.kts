// The app module. The engine is NOT built by AGP's externalNativeBuild: that would configure a second
// CMake tree and fetch Tracktion into it. The st0-engine `android-arm64` preset builds it where every
// other preset does, against the SDK's NDK, and the result is staged here as a JNI library.

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
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

val engineDir = rootDir.resolve("../st0-engine")

// The preset, with this SDK's NDK, through the same script as build:mac and build:win.
val buildEngine by tasks.registering(Exec::class) {
    workingDir = engineDir
    environment("ANDROID_NDK_HOME", android.ndkDirectory.absolutePath)
    commandLine("node", "scripts/build.mjs", "android-arm64")
}

val stageEngine by tasks.registering(Copy::class) {
    dependsOn(buildEngine)
    from(engineDir.resolve("build/android-arm64/libst0engine.so"))
    into(layout.buildDirectory.dir("engine-jni/arm64-v8a"))
}

tasks.named("preBuild") { dependsOn(stageEngine) }
