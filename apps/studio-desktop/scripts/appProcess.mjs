// appProcess.mjs — the app's edit→run loop as reusable steps: list every running tray,
// stop them, build the dev app, and launch it waiting for the merged log to say the
// supervisor came up. Every step THROWS instead of exiting, so a long-lived watcher can
// survive a failed build. Shared by restart-app.mjs and scripts/dev-native.mjs.
// See docs/restartApp.md.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stateDir } from "../../../scripts/stateDir.mjs";

const here = dirname(fileURLToPath(import.meta.url)); // apps/studio-desktop/scripts
export const trayDir = dirname(here); //                apps/studio-desktop
export const MERGED = join(stateDir(), ".studio.log"); // truncated by logbus::init on every launch
export const TRAY_LOG = join(trayDir, ".cache", "dev", "tray.log"); // where start-engine.mjs puts its stdout
/** The Electron app's own pid in dev, since unpackaged its image is `electron` (docs/restartApp.md). */
export const DEV_PID = join(trayDir, ".cache", "dev", "app.pid");
export const EXE_NAME =
  process.platform === "win32" ? "studio-capot.exe" : "studio-capot";
/** The engine. Stopped here too — see stopAll for why the tray's job object is not enough. */
export const ENGINE_EXE_NAME =
  process.platform === "win32" ? "st0-engine.exe" : "st0-engine";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A failure a caller may want to turn into an exit code rather than just a message. */
class StepError extends Error {
  constructor(message, status = 1) {
    super(message);
    this.status = status;
  }
}

function node(script, argv = []) {
  const r = spawnSync(process.execPath, [join(here, script), ...argv], {
    cwd: trayDir,
    stdio: "inherit",
  });
  if (r.status !== 0) throw new StepError(`${script} failed`, r.status ?? 1);
}

function capture(cmd, argv) {
  const r = spawnSync(cmd, argv, { encoding: "utf8" });
  return r.status === 0 && r.stdout ? r.stdout : "";
}

/** Every process with this image name, and where it was run from. */
function processesNamed(exe) {
  if (process.platform === "win32") {
    // -EncodedCommand, not -Command: the query is full of quotes and would not survive two levels of escaping.
    const q = `Get-CimInstance Win32_Process -Filter "Name='${exe}'" | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }`;
    const encoded = Buffer.from(q, "utf16le").toString("base64");
    return capture("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encoded,
    ])
      .split(/\r?\n/)
      .flatMap((l) => {
        const [pid, path] = l.trim().split("|");
        return pid ? [{ pid: Number(pid), path: path || exe }] : [];
      });
  }
  return capture("pgrep", ["-x", exe]) // -x: the process NAME, so a shell tailing the log is not one
    .split("\n")
    .flatMap((l) => (l.trim() ? [{ pid: Number(l.trim()), path: exe }] : []));
}

/** Alive? `kill 0` asks without signalling, and answers for a pid we did not spawn. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The dev app, read from its pidfile. Scanning by image name cannot find it: unpackaged the
 * process is `electron`, and killing every `electron` on the machine is not an option.
 */
function devApp() {
  try {
    const { pid, platform } = JSON.parse(readFileSync(DEV_PID, "utf8"));
    // A pidfile that crossed machines names an UNRELATED process here, and killing it would
    // be the worst outcome this file can have. Under WSL the tree is mirrored, so this is not
    // hypothetical — `.cache` is skipped for the same reason (../../../scripts/dev-native-bridge.mjs).
    if (platform !== process.platform) return [];
    if (Number.isInteger(pid) && pid > 0 && alive(pid))
      return [{ pid, path: `electron (dev, ${platform})` }];
    // A stale file outlives a crash; leaving it would make every later stop believe it worked.
    rmSync(DEV_PID, { force: true });
  } catch {}
  return [];
}

/**
 * Every tray, and not just ours: single-instance is keyed on the IDENTIFIER, not the path, so
 * a survivor silently wins and the new instance exits without a word (docs/restartApp.md).
 * Two ways to find one: the image name for an INSTALLED build, and the dev pidfile for an
 * unpackaged run, whose process is `electron`.
 */
export function running() {
  return [...processesNamed(EXE_NAME), ...devApp()];
}

/** Every engine process, whoever started it — and the same reasoning applies. See stopAll. */
export function runningEngines() {
  return processesNamed(ENGINE_EXE_NAME);
}

async function until(ok, ms, what) {
  for (let waited = 0; waited < ms; waited += 200) {
    if (ok()) return;
    await sleep(200);
  }
  throw new StepError(what);
}

/** Stop every tray AND every engine, waiting for both, and return how many trays there were (docs/restartApp.md). */
export async function stopAll() {
  const found = running();
  for (const { pid, path } of found)
    console.log(`▸ stopping tray (pid ${pid}) ${path}`);
  // A hard terminate on Windows, since the tray is windowless (docs/restartApp.md).
  for (const { pid } of found) {
    try {
      process.kill(pid);
    } catch {} // already gone between the scan and here
  }
  if (found.length)
    await until(
      () => running().length === 0,
      10_000,
      "the tray would not exit",
    );

  const engines = runningEngines();
  for (const { pid, path } of engines)
    console.log(`▸ stopping engine (pid ${pid}) ${path}`);
  for (const { pid } of engines) {
    try {
      process.kill(pid);
    } catch {} // the job object may have got there first
  }
  if (engines.length)
    await until(
      () => runningEngines().length === 0,
      10_000,
      "the engine would not exit — it is holding its own binary open",
    );
  return found.length;
}

/**
 * Rebuild the app's main process. Unlike the Rust it replaces, dist/main.cjs is not a linked
 * image, so a running app does not hold it open — the caller no longer has to stop first.
 */
export function buildDevApp() {
  node("build-main.mjs");
}

/** The merged log as of now, but only once THIS launch has truncated and rewritten it. */
function freshLog(since) {
  try {
    if (statSync(MERGED).mtimeMs <= since) return null;
    return readFileSync(MERGED, "utf8");
  } catch {
    return null;
  }
}

const tail = (path, n = 20) =>
  existsSync(path)
    ? readFileSync(path, "utf8").trimEnd().split("\n").slice(-n).join("\n")
    : "(empty)";

/** Start the dev app and WAIT for the merged log to say the supervisor came up (docs/restartApp.md). */
export async function launch() {
  const since = Date.now();
  node("start-engine.mjs");
  try {
    await until(() => running().length > 0, 5_000, "start failed");
  } catch {
    // The commonest early failure is the runtime not starting at all, and the merged log
    // does not exist yet — so its own stdout is the only thing that can say why.
    throw new StepError(
      `the app exited as soon as it started. Its output:\n${tail(TRAY_LOG)}`,
    );
  }

  // The tray's own stdout stays empty when all is well, so the merged log is the signal.
  let text = null;
  for (let waited = 0; waited < 20_000; waited += 250) {
    text = freshLog(since) ?? text;
    if (/supervisor (up|not found|won't start)/.test(text ?? "")) break;
    // Nothing reaches the merged log if the tray dies before logbus::init, so watch the process too.
    if (waited && waited % 2000 === 0 && !running().length) {
      throw new StepError(
        `the tray exited during startup. Its output:\n${tail(TRAY_LOG)}`,
      );
    }
    await sleep(250);
  }

  if (!text)
    throw new StepError(
      `no activity in ${MERGED} after 20s — the tray is up but silent.`,
    );
  const recent = text.trimEnd().split("\n").slice(-20).join("\n");
  if (!/supervisor up/.test(text))
    throw new StepError(`the supervisor did not come up:\n${recent}`);
  return recent;
}
