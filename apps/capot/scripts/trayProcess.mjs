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

const here = dirname(fileURLToPath(import.meta.url)); // apps/capot/scripts
export const trayDir = dirname(here); //                apps/capot
export const MERGED = join(homedir(), ".studio", ".studio.log"); // truncated by logbus::init on every launch
export const TRAY_LOG = join(trayDir, ".cache", "dev", "tray.log"); // where start-engine.mjs puts its stdout
export const EXE_NAME =
  process.platform === "win32" ? "studio-capot.exe" : "studio-capot";

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

/**
 * Every tray process, whatever build it came from — `out/dev`, `target/`, an installed
 * bundle. Deliberately not just ours: they share one identifier, so single-instance would
 * turn our launch into a silent no-op while a stranger keeps the menu bar.
 */
export function running() {
  if (process.platform === "win32") {
    // -EncodedCommand, not -Command: the query is full of quotes and would not survive two levels of escaping.
    const q = `Get-CimInstance Win32_Process -Filter "Name='${EXE_NAME}'" | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }`;
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
        return pid ? [{ pid: Number(pid), path: path || EXE_NAME }] : [];
      });
  }
  return capture("pgrep", ["-x", EXE_NAME]) // -x: the process NAME, so a shell tailing the log is not a tray
    .split("\n")
    .flatMap((l) =>
      l.trim() ? [{ pid: Number(l.trim()), path: EXE_NAME }] : [],
    );
}

async function until(ok, ms, what) {
  for (let waited = 0; waited < ms; waited += 200) {
    if (ok()) return;
    await sleep(200);
  }
  throw new StepError(what);
}

/** Stop every running tray and wait for them to be gone. Returns how many there were. */
export async function stopAll() {
  const found = running();
  if (!found.length) return 0;
  for (const { pid, path } of found)
    console.log(`▸ stopping tray (pid ${pid}) ${path}`);
  // A hard terminate on Windows: the tray is windowless, so there is no close to send it. Safe by design — the
  // job object created in main.rs takes the supervisor, the engine and the file service down with it.
  for (const { pid } of found) {
    try {
      process.kill(pid);
    } catch {} // already gone between the scan and here
  }
  await until(() => running().length === 0, 10_000, "the tray would not exit");
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
