// androidBuild.ts — the android target's global setup: builds the app's e2e variant and installs it on the phone.
// Gradle's own up-to-date checks make a second run cheap; the engine's C++ is the cold part (docs/e2e.md).
import { execFileSync, execSync } from "node:child_process";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { ANDROID_PACKAGE, adb, defaultSdk } from "./android.ts";

const ANDROID_DIR = join(
  import.meta.dirname,
  "..",
  "..",
  "engine",
  "k7-android",
);

export default function buildAndInstall(): void {
  // Before the build, not after it: a cold one takes minutes, and Gradle only notices a missing phone when it installs.
  try {
    adb("get-state");
  } catch {
    throw new Error("no Android device: attach one or set ANDROID_SERIAL");
  }
  if (process.env.E2E_ANDROID_BUILD !== "0") install();
  grantCapture();
}

// The microphone and camera, granted as a person would on the first prompt, which no WebView test can answer.
function grantCapture(): void {
  for (const permission of ["RECORD_AUDIO", "CAMERA"])
    adb(
      "shell",
      "pm",
      "grant",
      ANDROID_PACKAGE,
      `android.permission.${permission}`,
    );
}

function install(): void {
  const env = { ...process.env };
  env.ANDROID_HOME ??= defaultSdk();
  // Half the cores: a full engine build beside a dev session's own watcher has frozen a Mac before.
  env.CMAKE_BUILD_PARALLEL_LEVEL ??= String(
    Math.max(1, Math.floor(availableParallelism() / 2)),
  );
  const options = { cwd: ANDROID_DIR, env, stdio: "inherit" as const };
  if (process.platform !== "win32") {
    execFileSync("./gradlew", [":app:installE2e"], options);
    return;
  }
  // A .bat runs only through cmd (Node refuses it otherwise), and by full path: cmd may not search the working directory.
  execSync(`"${join(ANDROID_DIR, "gradlew.bat")}" :app:installE2e`, options);
}
