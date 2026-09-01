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
  process.platform === "win32" ? "st0-tray.exe" : "st0-tray";
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

/** Every tray process and not just ours, since they share one identifier (docs/restartTray.md). */
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

/** Stop every tray AND every engine, waiting for both, and return how many trays there were (docs/restartTray.md). */
export async function stopAll() {
  const found = running();
  for (const { pid, path } of found)
    console.log(`▸ stopping tray (pid ${pid}) ${path}`);
  // A hard terminate on Windows, since the tray is windowless (docs/restartTray.md).
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

/** Start the dev app and WAIT for the merged log to say the supervisor came up (docs/restartTray.md). */
export async function launch() {
  const since = Date.now();
  node("start-engine.mjs");
  await until(
    () => running().length > 0,
    5_000,
    "the tray exited as soon as it started",
  );

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
      `no ~/.st0/.studio.log activity after 20s — the tray is up but silent.`,
    );
  const recent = text.trimEnd().split("\n").slice(-20).join("\n");
  if (!/supervisor up/.test(text))
    throw new StepError(`the supervisor did not come up:\n${recent}`);
  return recent;
}
