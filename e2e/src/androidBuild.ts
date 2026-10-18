// androidBuild.ts — the android target's global setup: builds the app's e2e variant and installs it on the phone.
// Gradle's own up-to-date checks make a second run cheap; the engine's C++ is the cold part (docs/e2e.md).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { join } from "node:path";
import { adb } from "./android.ts";

const ANDROID_DIR = join(
  import.meta.dirname,
  "..",
  "..",
  "engine",
  "k7-android",
);

/** Where Android Studio puts the SDK on each desktop, for a shell that exports no ANDROID_HOME. */
function defaultSdk(): string | undefined {
  const candidates = {
    darwin: join(homedir(), "Library", "Android", "sdk"),
    linux: join(homedir(), "Android", "Sdk"),
    win32: join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk"),
  } as Record<string, string>;
  const dir = candidates[process.platform];
  return dir && existsSync(dir) ? dir : undefined;
}

export default function buildAndInstall(): void {
  // Before the build, not after it: a cold one takes minutes, and Gradle only notices a missing phone when it installs.
  try {
    adb("get-state");
  } catch {
    throw new Error("no Android device: attach one or set ANDROID_SERIAL");
  }
  if (process.env.E2E_ANDROID_BUILD === "0") return;
  const env = { ...process.env };
  env.ANDROID_HOME ??= defaultSdk();
  // Half the cores: a full engine build beside a dev session's own watcher has frozen a Mac before.
  env.CMAKE_BUILD_PARALLEL_LEVEL ??= String(
    Math.max(1, Math.floor(availableParallelism() / 2)),
  );
  const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  execFileSync(gradlew, [":app:installE2e"], {
    cwd: ANDROID_DIR,
    env,
    stdio: "inherit",
  });
}
