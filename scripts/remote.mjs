#!/usr/bin/env node
// remote.mjs — remote survival: Windows logon tasks so the browser editor (vscode.mjs),
// the dev session (tilt up) and the shared shell (console/server.mjs) come up with the
// machine, each OUTSIDE the others — no crash takes the others with it.
// `install | uninstall | status | run <name>`; `run` is the tasks' keep-alive wrapper,
// with logs in the tmpdir. See docs/remote.md.

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

// `loop` = keep-alive: relaunch on exit with backoff.
// `node:` scripts run under process.execPath; `tilt` is an exe found on the user PATH.
//
// No edge here any more: the LAN server reverse-proxies to these ports, so nothing this
// workstation starts terminates TLS. Caddy used to be the first entry — see docs/dev.md.
const SERVICES = {
  vscode: { node: join("scripts", "vscode.mjs"), loop: true },
  tilt: { cmd: "tilt", args: ["up", "--port", "10350"], loop: true },
  console: { node: join("scripts", "console", "server.mjs"), loop: true },
};

const logFile = (name) => join(tmpdir(), `studio-remote-${name}.log`);
const pidFile = (name) => join(tmpdir(), `studio-remote-${name}.pid`);
const taskName = (name) => `studio-${name}`;

function portFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

function ps(script) {
  return spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
    },
  );
}

/** The tasks' entry point: run one service under a keep-alive loop, logging to tmpdir. */
async function run(name) {
  const svc = SERVICES[name];
  try {
    if (statSync(logFile(name)).size > 5_000_000)
      writeFileSync(logFile(name), "");
  } catch {}
  const out = openSync(logFile(name), "a");
  writeFileSync(pidFile(name), String(process.pid));
  let backoff = 5_000;
  const [cmd, args] = svc.node
    ? [process.execPath, [join(repo, svc.node)]]
    : [svc.cmd, svc.args];
  for (;;) {
    writeSync(
      out,
      `\n[${new Date().toISOString()}] studio-remote: starting ${svc.node ?? svc.cmd}\n`,
    );
    const started = Date.now();
    const code = await new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd: repo,
        stdio: ["ignore", out, out],
        windowsHide: true,
      });
      child.on("error", (e) => {
        writeSync(out, `spawn failed: ${e.message}\n`);
        resolve(-1);
      });
      child.on("exit", (c) => resolve(c ?? -1));
    });
    if (!svc.loop) process.exit(code ?? 0);
    // A quick death doubles the wait (capped at 5 min); a minute of good service resets it.
    backoff =
      Date.now() - started > 60_000 ? 5_000 : Math.min(backoff * 2, 300_000);
    writeSync(
      out,
      `[${new Date().toISOString()}] exited (code ${code}) — retry in ${backoff / 1000}s\n`,
    );
    await new Promise((r) => setTimeout(r, backoff));
  }
}

function install() {
  const node = process.execPath;
  const vbs = join(repo, "scripts", "hidden.vbs");
  const self = join(repo, "scripts", "remote.mjs");
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    "$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME",
    // ExecutionTimeLimit 0 = unlimited: the default silently stops a task after 3 days.
    "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew",
  ];
  for (const name of Object.keys(SERVICES)) {
    const arg = `"${vbs}" "${node}" "${self}" run ${name}`;
    lines.push(
      `$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '${arg}' -WorkingDirectory '${repo}'`,
      `Register-ScheduledTask -TaskName '${taskName(name)}' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null`,
    );
  }
  const r = ps(lines.join("\n"));
  if (r.status !== 0) {
    console.error(r.stderr || "Register-ScheduledTask failed");
    process.exit(1);
  }
  for (const name of Object.keys(SERVICES))
    console.log(`  registered: ${taskName(name)} (at logon)`);
  console.log(`  logs: ${join(tmpdir(), "studio-remote-<name>.log")}`);
  return Object.keys(SERVICES);
}

/** Start the tasks now — except tilt when a dev session already runs by hand. */
async function startNow() {
  // 5224 is st0's vite server, the surest sign of a live dev session (turbo or an
  // earlier tilt): starting tilt then would spawn a SECOND one and fight every port.
  const devRunning = !(await portFree(5224));
  for (const name of Object.keys(SERVICES)) {
    if (name === "tilt" && devRunning) {
      console.log(
        "  a dev session is already running (port 5224) — studio-tilt is registered\n" +
          "  but NOT started. Stop your session, then: Start-ScheduledTask studio-tilt",
      );
      continue;
    }
    const r = ps(`Start-ScheduledTask -TaskName '${taskName(name)}'`);
    console.log(
      r.status === 0
        ? `  started: ${taskName(name)}`
        : `  could not start ${taskName(name)}: ${r.stderr}`,
    );
  }
}

function uninstall() {
  // Kill only processes whose command line proves they are ours — a stale pidfile
  // must never take an unrelated process down with a recycled pid. taskkill /T takes
  // the whole tree: serve-web, the console PTY and whatever npm run dev spawned.
  const lines = ["$ErrorActionPreference = 'Continue'"];
  for (const name of Object.keys(SERVICES)) {
    lines.push(
      `Stop-ScheduledTask -TaskName '${taskName(name)}' -ErrorAction SilentlyContinue`,
      `Unregister-ScheduledTask -TaskName '${taskName(name)}' -Confirm:$false -ErrorAction SilentlyContinue`,
    );
    if (existsSync(pidFile(name))) {
      const pid = Number(readFileSync(pidFile(name), "utf8").trim());
      if (Number.isInteger(pid) && pid > 0)
        lines.push(
          `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' -ErrorAction SilentlyContinue`,
          `if ($p -and $p.CommandLine -like '*remote.mjs* run*') { taskkill /PID ${pid} /T /F | Out-Null }`,
        );
      rmSync(pidFile(name), { force: true });
    }
  }
  ps(lines.join("\n"));
  for (const name of Object.keys(SERVICES))
    console.log(`  removed: ${taskName(name)}`);
}

async function status() {
  const names = Object.keys(SERVICES).map(taskName);
  const r = ps(
    `Get-ScheduledTask -TaskName ${names.map((n) => `'${n}'`).join(",")} -ErrorAction SilentlyContinue | ` +
      "ForEach-Object { '{0}: {1}' -f $_.TaskName, $_.State }",
  );
  console.log(
    r.stdout.trim() ||
      "  no studio-* task registered — run `npm run remote:install`",
  );
  for (const [label, port] of [
    ["vscode  (/dev)", 8798],
    ["tilt    (:10351)", 10350],
    ["console (/console)", 8797],
  ])
    console.log(
      `  ${label}: ${(await portFree(port)) ? "NOT serving" : `serving on ${port}`}`,
    );
}

const [verb, name] = process.argv.slice(2);
if (verb === "run" && SERVICES[name]) await run(name);
else if (process.platform !== "win32") {
  console.error(
    "install/uninstall/status manage Windows Scheduled Tasks — Windows only.",
  );
  process.exit(1);
} else if (verb === "install") {
  install();
  await startNow();
} else if (verb === "uninstall") uninstall();
else if (verb === "status") await status();
else {
  console.error(
    "usage: remote.mjs install | uninstall | status | run <vscode|tilt|console>",
  );
  process.exit(1);
}
