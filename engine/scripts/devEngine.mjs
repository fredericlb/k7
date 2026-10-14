// devEngine.mjs — the dev session's engine: the repo's supervisor build run as the command-line engine, with
// `<state>/engine-host.json` as its config, and every supervisor or engine already running stopped first.
// Steps THROW rather than exit, so the long-lived watcher survives a failed start. See docs/buildEngine.md.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stateDir } from "../../scripts/stateDir.mjs";

const exe = (n) => (process.platform === "win32" ? `${n}.exe` : n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** stdout, or null when the command did not answer — "produced no output" is a different fact. */
function capture(cmd, argv, okStatus = [0]) {
  const r = spawnSync(cmd, argv, { encoding: "utf8" });
  if (r.error || !okStatus.includes(r.status)) return null;
  return r.stdout ?? "";
}

/** Every process with this image name; a query that does not answer THROWS, "nothing running" being a different fact. */
function processesNamed(name) {
  let out = null;
  for (let attempt = 0; attempt < 3 && out === null; attempt++)
    out =
      process.platform === "win32"
        ? capture("powershell", [
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            Buffer.from(
              `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq '${exe(name)}' -or $_.ExecutablePath -like '*\\${exe(name)}' } | ForEach-Object { $_.ProcessId }`,
              "utf16le",
            ).toString("base64"),
          ])
        : capture("pgrep", ["-x", name], [0, 1]); // exit 1 is "none", an answer
  if (out === null) throw new Error(`could not list ${name} processes`);
  return out
    .split(/\r?\n/)
    .map((l) => Number(l.trim()))
    .filter((pid) => pid > 0);
}

async function stopNamed(name) {
  const pids = processesNamed(name);
  for (const pid of pids) {
    console.log(`▸ stopping ${name} (pid ${pid})`);
    try {
      process.kill(pid);
    } catch {} // gone between the scan and here
  }
  for (let waited = 0; pids.length && waited < 10_000; waited += 200) {
    if (!processesNamed(name).length) return;
    await sleep(200);
  }
  if (pids.length && processesNamed(name).length)
    throw new Error(
      `${name} would not exit — it is holding its own binary open`,
    );
}

let child = null;

/** Stop ours, then every supervisor and engine on the machine: a survivor holds the binary a relink replaces. */
export async function stopAll() {
  if (child) {
    child.kill("SIGTERM");
    child = null;
  }
  await stopNamed("st0-supervisor"); // first: it deregisters while its engine still answers
  await stopNamed("st0-engine");
}

/** The config the dev engine runs from: the settings file a desktop install keeps, created empty if absent. */
export function devConfig() {
  const file = join(stateDir(), "engine-host.json");
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{}\n");
  }
  return file;
}

/** Run `supervisor --config` as our child, its log on our stderr; throws when it exits within the first seconds. */
export async function launch(supervisor) {
  const config = devConfig();
  const proc = spawn(supervisor, ["--config", config], {
    stdio: ["ignore", "ignore", "inherit"],
    windowsHide: true,
  });
  let exited = null;
  proc.on("exit", (code) => {
    exited = code ?? 1;
  });
  child = proc;
  await sleep(3000);
  if (exited !== null) {
    child = null;
    throw new Error(`the supervisor exited at once (code ${exited})`);
  }
  return `supervisor up (pid ${proc.pid}), config ${config}`;
}
