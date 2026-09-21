#!/usr/bin/env node
// stop-host-port.mjs — end the previous host task and do not return until its port is free. Runs
// ON Windows, called by the bridge from the distro: an interop kill reaches cmd.exe and leaves the
// node under it holding the port. See docs/wsl.md.
//
// Two ways of finding it, and the second is what makes this reliable: whoever LISTENS on the port,
// and — given a tag — whatever PID `run-tagged` recorded, which is true even during a boot.

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { pidFileFor } from "./host-pid.mjs";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  console.error("usage: stop-host-port <port> [tag]");
  process.exit(2);
}

const log = (msg) => console.log(`stop-host-port | ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The pids listening on `port`, as strings — netstat rather than PowerShell, which every Windows has. */
function listeners() {
  const out = spawnSync("netstat", ["-ano", "-p", "TCP"], {
    encoding: "utf8",
    windowsHide: true,
  }).stdout;
  const pids = new Set();
  for (const line of (out ?? "").split(/\r?\n/)) {
    const m = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/.exec(line);
    if (m && Number(m[1]) === port) pids.add(m[2]);
  }
  return pids;
}

/** Is `pid` still a node? Pids are recycled, and killing a stranger is worse than missing one. */
function isNode(pid) {
  const out =
    spawnSync(
      "tasklist",
      ["/FI", `PID eq ${pid}`, "/FI", "IMAGENAME eq node.exe", "/NH"],
      { encoding: "utf8", windowsHide: true },
    ).stdout ?? "";
  return /node\.exe/i.test(out);
}

// The task's OWN pid, written when it launched: this is what reaches one that is still STARTING
// and therefore listening on nothing — the case the port sweep below cannot see.
const tag = process.argv[3];
if (tag) {
  const file = pidFileFor(tag);
  let pid = "";
  try {
    pid = readFileSync(file, "utf8").trim();
  } catch {
    // No file: nothing was started this way, or it already cleaned up after itself.
  }
  if (pid && isNode(pid)) {
    log(`killing tagged pid ${pid} (${tag}), booting or not`);
    spawnSync("taskkill", ["/PID", pid, "/T", "/F"], { windowsHide: true });
  }
  rmSync(file, { force: true });
}

for (const pid of listeners()) {
  log(`killing pid ${pid}, which holds ${port}`);
  // `/T` is the whole point: npm spawns tsx spawns node, and only the last one has the socket.
  spawnSync("taskkill", ["/PID", pid, "/T", "/F"], { windowsHide: true });
}

/** Free means BINDABLE: Windows drops the netstat row well before it lets the port go again. */
const bindable = () =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "0.0.0.0");
  });

// taskkill returns before the socket is gone, and the replacement then dies on EADDRINUSE.
const until = Date.now() + 10_000;
let free = await bindable();
while (!free && Date.now() < until) {
  await sleep(100);
  free = await bindable();
}
log(free ? `${port} is free` : `✖ ${port} is still held after 10s`);
