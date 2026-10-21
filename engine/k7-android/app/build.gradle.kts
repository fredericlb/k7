// The app module. Neither native program is built by AGP's externalNativeBuild: that would configure
// second CMake trees and fetch Tracktion into one. Each `android-arm64` preset builds where every other
// preset does, against the SDK's NDK, and the results are staged here: the engine as the JNI library it
// is, the supervisor as an EXECUTABLE named like one, since only lib*.so files reach the native library
// directory — the one place Android lets an app run its own binary.

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// npm is a .cmd on Windows, which an Exec task does not resolve from the bare name.
val npm = if (System.getProperty("os.name").startsWith("Windows")) "npm.cmd" else "npm"

// The table the desktop app starts its backend with too (apps/k7/backend/docs/standalone.md): its port is a constant here.
val standalone = groovy.json.JsonSlurper().parse(rootDir.resolve("../../apps/k7/backend/standalone.json")) as Map<*, *>

// The e2e build's backend port: the shipped app holds standalone.json's on the same loopback, and e2e/src/android.ts dials this one.
val E2E_PORT = 18799

// The root package.json's version, the one every artefact ships under (docs/versioning.md); a snapshot adds its stamp.
val rootVersion = (groovy.json.JsonSlurper().parse(rootDir.resolve("../../package.json")) as Map<*, *>)["version"] as String
val releaseStamp = System.getenv("STUDIO_RELEASE_STAMP").orEmpty()
val appVersionName = if (releaseStamp.matches(Regex("snapshot-[0-9a-f]+"))) "$rootVersion-$releaseStamp" else rootVersion
// The stamp Updates.kt compares with k7.rocks/app_downloads: a CI shape on a release build, empty anywhere else, which checks nothing.
val updateStamp = releaseStamp.takeIf { it.matches(Regex("""v\d+\.\d+\.\d+|snapshot-[0-9a-f]{7,40}""")) }.orEmpty()

fun git(vararg args: String): String =
    providers.exec { commandLine("git", *args); workingDir = rootDir }.standardOutput.asText.get().trim()

// The commit count: it grows with every descendant commit, so an update always outranks what it replaces.
val appVersionCode = if (git("rev-parse", "--is-shallow-repository") == "true")
    throw GradleException("a shallow clone has no history to count for versionCode (docs/versioning.md)")
else git("rev-list", "--count", "HEAD").toInt()

// The release key comes from the environment only, never from a file in the tree (docs/release.md).
val releaseKeystore = System.getenv("K7_ANDROID_KEYSTORE_FILE")?.takeIf { it.isNotBlank() }

fun releaseSecret(name: String): String =
    System.getenv(name)?.takeIf { it.isNotEmpty() } ?: throw GradleException("K7_ANDROID_KEYSTORE_FILE is set but $name is not")

android {
    namespace = "se.frediver.k7"
    compileSdk = 36
    ndkVersion = "29.0.14206865"

    defaultConfig {
        applicationId = "se.frediver.k7"
        minSdk = 29
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersionName
        ndk { abiFilters += "arm64-v8a" }
        buildConfigField("int", "STANDALONE_PORT", standalone["port"].toString())
        // The backend's folders the engine is sent files from by their own paths: its workspaces and médiathèque.
        val dirs = standalone["dirs"] as Map<*, *>
        buildConfigField("String", "ENGINE_ROOT_DIRS", "\"${dirs["STUDIO_FILES_ROOT"]};${dirs["STUDIO_MEDIATEK"]}\"")
        buildConfigField("String", "RELEASE_STAMP", "\"\"")
        manifestPlaceholders["appLabel"] = "k7"
    }

    buildFeatures { buildConfig = true }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = releaseSecret("K7_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = releaseSecret("K7_ANDROID_KEY_ALIAS")
                keyPassword = releaseSecret("K7_ANDROID_KEY_PASSWORD")
            }
        }
    }

    // Without the key's environment, assembleRelease leaves app-release-unsigned.apk, which nothing publishes.
    buildTypes {
        getByName("release") {
            isDebuggable = false
            // No R8: Capacitor's bridge and the JNI entry points are reached by reflection, and no keep rules cover them.
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.findByName("release")
            buildConfigField("String", "RELEASE_STAMP", "\"$updateStamp\"")
        }
        // The functional suite's build: installed BESIDE the shipped app, so its own id, port and label (e2e/docs/e2e.md).
        create("e2e") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".e2e"
            versionNameSuffix = "-e2e"
            buildConfigField("int", "STANDALONE_PORT", E2E_PORT.toString())
            manifestPlaceholders["appLabel"] = "k7 e2e"
            matchingFallbacks += "debug"
        }
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
    // AuthHandoff's sign-in in a Custom Tab rather than a full browser switch.
    implementation("androidx.browser:browser:1.8.0")
    // CertTrust's decision runs on the JVM alone (app/src/test).
    testImplementation("junit:junit:4.13.2")
}

val engineDir = rootDir.resolve("../k7-runtime")
val supervisorDir = rootDir.resolve("../k7-supervisor")

// The preset, with this SDK's NDK, through the same script as build:mac and build:win.
val buildEngine by tasks.registering(Exec::class) {
    workingDir = engineDir
    environment("ANDROID_NDK_HOME", android.ndkDirectory.absolutePath)
    commandLine("node", "scripts/build.mjs", "android-arm64")
}

// The supervisor through engine/scripts/supervisorBuild.mjs, the desktop build's own entry, told which preset to use.
val buildSupervisor by tasks.registering(Exec::class) {
    workingDir = rootDir.resolve("../..")
    environment("ANDROID_NDK_HOME", android.ndkDirectory.absolutePath)
    environment("STUDIO_SUPERVISOR_PRESET", "android-arm64")
    commandLine(
        "node", "-e",
        "import('./engine/scripts/supervisorBuild.mjs').then((m) => m.buildSupervisor(process.cwd()))",
    )
}

val stageEngine by tasks.registering(Copy::class) {
    dependsOn(buildEngine, buildSupervisor)
    from(engineDir.resolve("build/android-arm64/libk7runtime.so"))
    from(supervisorDir.resolve("build/android-arm64/k7-supervisor")) { rename { "libk7supervisor.so" } }
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
    commandLine(npm, "run", "build")
}

val stageShell by tasks.registering(Sync::class) {
    dependsOn(buildShell)
    from(webDir.resolve("dist")) { into("public") }
    from(webDir.resolve("capacitor.config.json"))
    from(resources.text.fromString("[]")) { rename { "capacitor.plugins.json" } }
    into(shellOut)
}

android.sourceSets["main"].assets.srcDir(shellOut)

// The standalone half (BackendHost.kt): Termux's node as lib*.so files beside the engine,
// and k7's backend bundled for that node, with the files it reads, as one zip the app unpacks.
val termuxCache = layout.buildDirectory.dir("termux-cache")
val termuxJni = layout.buildDirectory.dir("termux-jni")
val termuxAssets = layout.buildDirectory.dir("termux-assets")

val stageTermuxTools by tasks.registering(Exec::class) {
    inputs.files(rootDir.resolve("scripts/termux-tools.mjs"), rootDir.resolve("scripts/termux-packages.json"))
    outputs.dirs(termuxJni, termuxAssets)
    environment("ANDROID_NDK_HOME", android.ndkDirectory.absolutePath)
    commandLine(
        "node", rootDir.resolve("scripts/termux-tools.mjs").absolutePath,
        termuxJni.get().dir("arm64-v8a").asFile.absolutePath,
        termuxAssets.get().dir("termux").asFile.absolutePath,
        termuxCache.get().asFile.absolutePath,
    )
}

android.sourceSets["main"].jniLibs.srcDir(termuxJni)
android.sourceSets["main"].assets.srcDir(termuxAssets)

val repoDir = rootDir.resolve("../..")

// The frontend the backend serves, as the desktop app's staging builds it.
val buildFrontend by tasks.registering(Exec::class) {
    workingDir = repoDir
    commandLine(npm, "exec", "--workspace", "k7-frontend", "--", "vite", "build")
}

val backendTree = layout.buildDirectory.dir("backend-tree")

val bundleBackend by tasks.registering(Exec::class) {
    dependsOn(buildFrontend)
    workingDir = repoDir
    commandLine("node", repoDir.resolve("apps/k7/backend/scripts/bundle.mjs").absolutePath, backendTree.get().asFile.absolutePath)
}

val backendAssets = layout.buildDirectory.dir("backend-assets")

val stageBackend by tasks.registering(Zip::class) {
    dependsOn(bundleBackend)
    from(backendTree)
    from(repoDir.resolve("apps/k7/backend/standalone.json"))
    archiveFileName.set("backend.zip")
    destinationDirectory.set(backendAssets)
}

android.sourceSets["main"].assets.srcDir(backendAssets)
// The zip is already compressed: aapt must not deflate it again, and the app streams it out as it is.
android.androidResources.noCompress += "zip"

tasks.named("preBuild") { dependsOn(stageEngine, stageFaustLibs, stageShell, stageTermuxTools, stageBackend) }
