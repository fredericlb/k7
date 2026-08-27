#!/usr/bin/env node
// server.mjs — the shared terminals at https://console.priv.frediver.se (its own origin, served at
// the root): PowerShell TABS in ConPTYs this service owns, so they survive their
// viewers; every browser sees the same tabs and types into the same shells (a `claude`
// session in one outlives the tab that launched it). The Tilt UI runs the dev session
// and has no stdin; this page is its terminal-shaped companion. See docs/remote.md.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pty from "node-pty";
import { WebSocketServer } from "ws";

const here = dirname(fileURLToPath(import.meta.url));

const PORT = 8797; // free: the proxy routes 3001-3006, 5173, 5223-5225, 8080, 8787-8796, 8798
const SCROLLBACK_CAP = 1 << 20; // ~1 MiB of raw PTY output per tab, enough for a post-mortem
const MAX_TABS = 12; // a runaway "+" should not fork-bomb the machine
const MAX_NAME = 24; // a tab label the bar can still show
// Derived from the git.exe on PATH, never `where bash`: System32's is WSL's (../../docs/remote.md).
function findGitBash() {
  const r = spawnSync("where.exe", ["git.exe"], { encoding: "utf8" });
  for (const line of (r.stdout ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    for (const up of ["..", join("..", "..")]) {
      const root = join(dirname(line.trim()), up);
      const bash = [
        join(root, "bin", "bash.exe"),
        join(root, "usr", "bin", "bash.exe"),
      ].find((p) => existsSync(p));
      if (bash) return bash;
    }
  }
  return null;
}

// Every shell on the machine is a tab flavor, spawned DIRECTLY: `cmd /c` is a quoting lottery.
function detectShells() {
  if (process.platform !== "win32") {
    const sh = process.env.SHELL ?? "/bin/sh";
    return { sh: { file: sh, args: [], display: sh } };
  }
  const shells = {
    powershell: {
      file: "powershell.exe",
      args: ["-NoLogo"],
      display: "powershell",
    },
  };
  const gitBash = findGitBash();
  if (gitBash)
    shells.bash = { file: gitBash, args: ["-i", "-l"], display: "git bash" };
  // The distro is where the tree lives, so it is a flavour like the others — `--cd ~` for the LINUX home.
  if (spawnSync("wsl.exe", ["-l", "-q"], { encoding: "utf8" }).status === 0)
    shells.wsl = { file: "wsl.exe", args: ["--cd", "~"], display: "wsl" };
  return shells;
}
const SHELLS = detectShells();
// Overridable (tests, or pointing the page at something other than a plain shell).

// biome-ignore lint/suspicious/noUndeclaredEnvVars: this server never runs under turbo
const customCmd = process.env.STUDIO_CONSOLE_CMD;
if (customCmd)
  SHELLS.custom =
    process.platform === "win32"
      ? { file: "cmd.exe", args: ["/c", customCmd], display: customCmd }
      : { file: "/bin/sh", args: ["-c", customCmd], display: customCmd };
// The distro first when there is one: that is where the sources and every npm command live (../docs/wsl.md).
const DEFAULT_SHELL = customCmd
  ? "custom"
  : SHELLS.wsl
    ? "wsl"
    : SHELLS.bash
      ? "bash"
      : Object.keys(SHELLS)[0];

// Where every tab starts: the user's home.
const CWD = homedir();

// A session is one shared PTY, sizes included — the last device to attach or resize wins.
const sessions = new Map();
let nextId = 1;
const clients = new Set(); // each ws carries .attached, the id of the tab it views

const tabsMsg = () => ({
  t: "tabs",
  shells: Object.keys(SHELLS),
  def: DEFAULT_SHELL,
  tabs: [...sessions.values()].map((s) => ({
    id: s.id,
    shell: s.shell,
    name: s.name,
    cmd: SHELLS[s.shell].display,
    running: s.child !== null,
    pid: s.child?.pid ?? null,
    exit: s.lastExit,
  })),
});

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcastTabs() {
  for (const c of clients) send(c, tabsMsg());
}

function append(s, d) {
  s.scrollback = (s.scrollback + d).slice(-SCROLLBACK_CAP);
  for (const c of clients)
    if (c.attached === s.id) send(c, { t: "out", id: s.id, d });
}

function start(s) {
  if (s.child) return;
  s.lastExit = null;
  // A fresh shell gets a fresh screen: two replays back to back are noise.
  s.scrollback = "";
  for (const c of clients)
    if (c.attached === s.id) send(c, { t: "clear", id: s.id });
  const spec = SHELLS[s.shell];
  s.child = pty.spawn(spec.file, spec.args, {
    name: "xterm-256color",
    cwd: CWD,
    env: process.env,
    cols: s.size.cols,
    rows: s.size.rows,
  });
  s.child.onData((d) => append(s, d));
  s.child.onExit(({ exitCode }) => {
    s.child = null;
    s.lastExit = exitCode;
    clearTimeout(s.killTimer);
    s.killTimer = null;
    if (!sessions.has(s.id)) return; // the tab was closed — nobody to tell
    append(
      s,
      `\r\n\x1b[7m studio \x1b[27m session terminée (code ${exitCode})\r\n`,
    );
    broadcastTabs();
    if (s.restartPending) {
      s.restartPending = false;
      start(s);
    }
  });
  broadcastTabs();
}

// Ctrl-C first and patiently; the hard kill is only for a process that no longer listens.
function stop(s) {
  if (!s.child) return;
  s.child.write("\x03");
  s.killTimer ??= setTimeout(() => s.child?.kill(), 8000);
}

function resize(s, cols, rows) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return;
  s.size = {
    cols: Math.min(Math.max(cols, 20), 500),
    rows: Math.min(Math.max(rows, 5), 200),
  };
  s.child?.resize(s.size.cols, s.size.rows);
}

// An alt-screen TUI repaints on a resize, so one row of jiggle gives a late joiner a clean screen.
function nudge(s) {
  if (!s.child) return;
  s.child.resize(s.size.cols, s.size.rows + 1);
  s.child.resize(s.size.cols, s.size.rows);
}

function createSession(shell = DEFAULT_SHELL) {
  const s = {
    id: String(nextId++),
    shell,
    name: null, // what the user called this tab; the page falls back to id·shell
    child: null,
    lastExit: null,
    restartPending: false,
    killTimer: null,
    size: { cols: 200, rows: 50 },
    scrollback: "",
  };
  sessions.set(s.id, s);
  start(s);
  return s;
}

function closeSession(s) {
  sessions.delete(s.id); // first, so onExit knows this death is wanted
  s.restartPending = false;
  clearTimeout(s.killTimer);
  s.child?.kill();
  if (sessions.size === 0) createSession(); // there is always a tab to land on
  // No forced reattach: each client re-attaches itself, since the page owns `current`.
  broadcastTabs();
}

function attach(ws, id) {
  const s = sessions.get(id);
  if (!s) return;
  ws.attached = id;
  send(ws, { t: "clear", id });
  if (s.scrollback) send(ws, { t: "out", id, d: s.scrollback });
  nudge(s);
}

const require = createRequire(import.meta.url);
const ASSETS = {
  "/xterm.js": [
    require.resolve("@xterm/xterm/lib/xterm.js"),
    "text/javascript",
  ],
  "/xterm.css": [require.resolve("@xterm/xterm/css/xterm.css"), "text/css"],
  "/addon-fit.js": [
    require.resolve("@xterm/addon-fit/lib/addon-fit.js"),
    "text/javascript",
  ],
};
const page = readFileSync(join(here, "index.html"));

const http = createServer((req, res) => {
  const path = req.url.split("?")[0];
  if (path === "/") {
    res
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(page);
  } else if (ASSETS[path]) {
    const [file, type] = ASSETS[path];
    res.writeHead(200, { "content-type": type }).end(readFileSync(file));
  } else {
    res.writeHead(404).end();
  }
});

const wss = new WebSocketServer({ server: http, path: "/ws" });
wss.on("connection", (ws) => {
  clients.add(ws);
  send(ws, tabsMsg()); // the client picks a tab and asks to attach
  ws.on("message", (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.t === "new") {
      if (sessions.size >= MAX_TABS) return;
      const shell = SHELLS[m.shell] ? m.shell : DEFAULT_SHELL;
      // The requester attaches itself on this reply — the page owns `current`.
      send(ws, { t: "created", id: createSession(shell).id });
      return;
    }
    const s = sessions.get(m.id);
    if (!s) return;
    if (m.t === "attach") attach(ws, m.id);
    else if (m.t === "in") s.child?.write(String(m.d));
    else if (m.t === "resize") resize(s, m.cols, m.rows);
    else if (m.t === "start") start(s);
    else if (m.t === "stop") stop(s);
    else if (m.t === "close") closeSession(s);
    else if (m.t === "rename") {
      // The name lives with the SESSION, so it survives a restart and every viewer sees it.
      s.name =
        String(m.name ?? "")
          .trim()
          .slice(0, MAX_NAME) || null;
      broadcastTabs();
    } else if (m.t === "restart") {
      if (s.child) {
        s.restartPending = true;
        stop(s);
      } else start(s);
    }
  });
  ws.on("close", () => clients.delete(ws));
});

http.on("error", (e) => {
  if (e.code === "EADDRINUSE")
    console.error(
      `port ${PORT} is already in use — another console is serving (or an orphan holds it:\n` +
        `find it with \`Get-NetTCPConnection -LocalPort ${PORT}\` and stop that process tree).`,
    );
  else console.error(`console server failed: ${e.message}`);
  process.exit(1);
});

// 0.0.0.0 and NOT loopback: the LAN proxy is on another machine (../../docs/remote.md).
http.listen(PORT, "0.0.0.0", () => {
  console.log(
    `  console → https://console.priv.frediver.se/  (shells: ${Object.keys(SHELLS).join(", ")}; cwd: ${CWD})`,
  );
  createSession();
});
