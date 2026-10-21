// devEngine.mjs — what the dev session stops before it relinks: every tray, supervisor and engine running on the
// machine, the dev tray's and an installed one's alike. Steps THROW rather than exit, so the long-lived watcher survives
// a failed stop. See docs/buildEngine.md.

import { spawnSync } from "node:child_process";

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

/** Every tray, supervisor and engine on the machine: a survivor holds the binary a relink replaces. */
export async function stopAll() {
  await stopNamed("k7-tray"); // its job object takes its backend along; on Unix its pipes do
  await stopNamed("k7-supervisor"); // then any left: it deregisters while its engine still answers
  await stopNamed("k7-runtime");
}
