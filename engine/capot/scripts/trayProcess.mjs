// trayProcess.mjs — the tray's edit→run loop as reusable steps: list every running tray,
// stop them, build the dev app, and launch it waiting for the merged log to say the
// supervisor came up. Every step THROWS instead of exiting, so a long-lived watcher can
// survive a failed build. Shared by restart-tray.mjs and scripts/dev-native.mjs.
// See docs/restartTray.md.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // engine/capot/scripts
export const trayDir = dirname(here); //                engine/capot
export const MERGED = join(homedir(), ".studio", ".studio.log"); // truncated by logbus::init on every launch
export const TRAY_LOG = join(trayDir, ".cache", "dev", "tray.log"); // where start-engine.mjs puts its stdout
export const EXE_NAME =
  process.platform === "win32" ? "studio-capot.exe" : "studio-capot";
/** The engine. Stopped here too — see stopAll for why the tray's job object is not enough. */
export const ENGINE_EXE_NAME =
  process.platform === "win32" ? "studio-moteur.exe" : "studio-moteur";

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

/**
 * Every tray process, whatever build it came from — `out/dev`, `target/`, an installed
 * bundle. Deliberately not just ours: they share one identifier, so single-instance would
 * turn our launch into a silent no-op while a stranger keeps the menu bar.
 */
export function running() {
  return processesNamed(EXE_NAME);
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

/**
 * Stop every running tray AND every engine, and wait for both to be gone. Returns how many
 * trays there were.
 *
 * The engine half is not belt-and-braces, and this used to be tray-only. Two ways an engine
 * outlives the tray that is supposed to take it down:
 *
 *  1. **The job object teardown is asynchronous.** Killing the tray returns as soon as the
 *     tray is gone; the OS unwinds the rest of the job afterwards. Waiting only for the tray
 *     let a build start while the engine was still up.
 *  2. **An ADOPTED engine is in no job at all.** Job membership is inherited at creation, so
 *     an engine started by an earlier tray and adopted by this one (`engineProcess.ts`:
 *     *"It is NOT ours — Stop must leave it alone"*) belongs to the DEAD tray's job. Nothing
 *     takes it down. `devReload.ts` makes that routine in dev: every edit under
 *     `packages/engine-host/src` restarts the supervisor and has the engine adopted.
 *
 * Either way the survivor keeps `studio-moteur.exe` open for execute, and the next relink
 * cannot replace the image — silently, which is what makes it expensive. See docs/dev.md.
 *
 * Every engine, whoever started it, for the same reason `running()` lists every tray: a
 * survivor silently wins, and here it wins by making your build a no-op.
 */
export async function stopAll() {
  const found = running();
  for (const { pid, path } of found)
    console.log(`▸ stopping tray (pid ${pid}) ${path}`);
  // A hard terminate on Windows: the tray is windowless, so there is no close to send it. The job object
  // created in main.rs is what takes the supervisor and the file service with it.
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

/** Rebuild the debug tray app into out/dev. The caller must have stopped it first. */
export function buildDevApp() {
  node("build-engine.mjs", ["--dev"]);
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

/**
 * Start the dev app and wait until the merged log says the supervisor came up. Returns
 * that log's tail on success; throws with it on failure, because a tray that supervises
 * nothing looks exactly like a healthy one from the outside.
 */
export async function launch() {
  const since = Date.now();
  node("start-engine.mjs");
  await until(
    () => running().length > 0,
    5_000,
    "the tray exited as soon as it started",
  );

  // The tray's own stdout stays empty when all is well, so the merged log is the signal: host.rs writes
  // "supervisor up" there, and writes just as loudly when there is nothing to supervise.
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
      `no ~/.studio/.studio.log activity after 20s — the tray is up but silent.`,
    );
  const recent = text.trimEnd().split("\n").slice(-20).join("\n");
  if (!/supervisor up/.test(text))
    throw new StepError(`the supervisor did not come up:\n${recent}`);
  return recent;
}
