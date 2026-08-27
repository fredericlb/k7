#!/usr/bin/env node
// stop-host-port.mjs — end whatever listens on a port, tree included, and do not return until the
// port is free. Runs ON Windows, called by the bridge from the distro: an interop kill reaches
// cmd.exe and leaves the node under it holding the port. See docs/wsl.md.

import { spawnSync } from "node:child_process";
import { createServer } from "node:net";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  console.error("usage: stop-host-port <port>");
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
