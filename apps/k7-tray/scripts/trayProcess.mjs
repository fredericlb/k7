// trayProcess.mjs — the tray's edit→run loop as reusable steps: list every running tray,
// stop them, bundle the main process, and launch it waiting for the merged log to say the
// supervisor came up. Every step THROWS instead of exiting, so a long-lived watcher can
// survive a failed build. Used by restart-tray.mjs.
// See docs/restartTray.md.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stateDir } from "../../../scripts/stateDir.mjs";

const here = dirname(fileURLToPath(import.meta.url)); // apps/k7-tray/scripts
export const trayDir = dirname(here); //                apps/k7-tray
// `<state>/.studio.log`, as src/paths.ts names it — through stateDir.mjs rather than a hand-joined home, so $STUDIO_HOME moves it too.
export const MERGED = join(stateDir(), ".studio.log"); // truncated by the tray on every launch
export const TRAY_LOG = join(trayDir, ".cache", "dev", "tray.log"); // where start-detached.mjs puts its stdout
/** An INSTALLED tray; a dev one runs as Electron and is found by its command line instead. */
export const EXE_NAME =
  process.platform === "win32" ? "k7-tray.exe" : "k7-tray";
/** The engine. Stopped here too — see stopAll for why the tray's job object is not enough. */
export const ENGINE_EXE_NAME =
  process.platform === "win32" ? "k7-runtime.exe" : "k7-runtime";

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

/** stdout, or null when the command did not answer — "produced no output" is a different fact. */
function capture(cmd, argv, okStatus = [0]) {
  const r = spawnSync(cmd, argv, { encoding: "utf8" });
  if (r.error || !okStatus.includes(r.status)) return null;
  return r.stdout ?? "";
}

/** One look at the process table, or null when the query itself failed. */
function scan(exe) {
  if (process.platform === "win32") {
    // By path as well as name: a running tray whose exe was replaced has a garbled name (docs/restartTray.md).
    const q = `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq '${exe}' -or $_.ExecutablePath -like '*\\${exe}' } | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }`;
    // -EncodedCommand, not -Command: the query is full of quotes and would not survive two levels of escaping.
    const encoded = Buffer.from(q, "utf16le").toString("base64");
    return capture("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encoded,
    ]);
  }
  // pgrep reports "nothing matched" as exit 1, which is an ANSWER; 2 and up are the failure.
  return capture("pgrep", ["-x", exe], [0, 1]); // -x: the NAME, so a shell tailing the log is not one
}

/** Every process with this image name and its path; a query that never answers THROWS, never reads as "none" (docs/restartTray.md). */
function processesNamed(exe) {
  let out = null;
  for (let attempt = 0; attempt < 3 && out === null; attempt++) out = scan(exe);
  if (out === null) throw new StepError(`could not list ${exe} processes`);
  return out.split(/\r?\n/).flatMap((l) => {
    const [pid, path] = l.trim().split("|");
    return pid ? [{ pid: Number(pid), path: path || exe }] : [];
  });
}

/** Electron main processes running THIS checkout's tray; helpers carry `--type=` and are left to die with them. */
function devTrays() {
  let out = null;
  for (let attempt = 0; attempt < 3 && out === null; attempt++)
    if (process.platform === "win32") {
      const q = `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -like '*${trayDir}*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }`;
      out = capture("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(q, "utf16le").toString("base64"),
      ]);
    } else {
      const escaped = trayDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = capture("pgrep", ["-f", `[Ee]lectron ${escaped}$`], [0, 1]);
    }
  if (out === null) throw new StepError("could not list dev tray processes");
  return out.split(/\r?\n/).flatMap((l) => {
    const [pid, path] = l.trim().split("|");
    return pid
      ? [{ pid: Number(pid), path: path || `electron ${trayDir}` }]
      : [];
  });
}

/** Every tray, installed or dev: they share one single-instance lock, so a survivor makes the next launch a no-op. */
export function running() {
  return [...processesNamed(EXE_NAME), ...devTrays()];
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

/** Bundle the main process and preload into dist/: a dev tray runs that, on the repo's supervisor build. */
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

/** Start the dev app and WAIT for the merged log to say the supervisor came up (docs/restartTray.md). */
export async function launch() {
  const since = Date.now();
  node("start-detached.mjs");
  await until(
    () => running().length > 0,
    5_000,
    "the tray exited as soon as it started",
  );

  // The tray's own stdout stays empty when all is well, so the merged log is the signal.
  let text = null;
  for (let waited = 0; waited < 20_000; waited += 250) {
    text = freshLog(since) ?? text;
    if (/supervisor (up|not found)|could not start supervisor/.test(text ?? ""))
      break;
    // Nothing reaches the merged log if the tray dies before opening it, so watch the process too.
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
