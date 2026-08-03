#!/usr/bin/env node
// restart-tray.mjs — `npm run tray:restart`: the tray's edit→run loop, built out of the two
// scripts that already exist. Stops every running tray (single-instance would make our launch
// the no-op, and Windows locks the exe against the relink), rebuilds the dev app, starts it,
// and waits for the merged log to say the supervisor came up — so the exit code, not a
// screenshot, says whether the tray is alive. See docs/restartTray.md.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // apps/capot/scripts
const trayDir = dirname(here); //                      apps/capot
const MERGED = join(homedir(), ".lanes", ".lanes.log"); // truncated by logbus::init on every launch
const TRAY_LOG = join(trayDir, ".cache", "dev", "tray.log"); // where start-engine.mjs puts its stdout
const EXE_NAME =
  process.platform === "win32" ? "studio-capot.exe" : "studio-capot";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function node(script, argv = []) {
  const r = spawnSync(process.execPath, [join(here, script), ...argv], {
    cwd: trayDir,
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
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
function running() {
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
    if (ok()) return true;
    await sleep(200);
  }
  fail(what);
}

async function stop() {
  const found = running();
  if (!found.length) return;
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

await stop();
if (flag("stop")) process.exit(0);
if (!flag("no-build")) node("build-engine.mjs", ["--dev"]);

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
    fail(`the tray exited during startup. Its output:\n${tail(TRAY_LOG)}`);
  }
  await sleep(250);
}

if (!text)
  fail(
    `no ~/.lanes/.lanes.log activity after 20s — the tray is up but silent.`,
  );
console.log(`\n${text.trimEnd().split("\n").slice(-20).join("\n")}`);
if (!/supervisor up/.test(text))
  fail("the supervisor did not come up (see above).");
