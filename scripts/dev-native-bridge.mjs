#!/usr/bin/env node
// dev-native-bridge.mjs — the native task when the sources live in WSL and the MSVC/cargo
// toolchain does not. It mirrors the tree onto the host's NTFS and runs dev-native.mjs THERE,
// unchanged, so the whole native half keeps the shape docs/dev.md describes. Nothing is built
// across the share: MSBuild lowercases the dependency it tracks, which a case-sensitive
// filesystem then fails to find, and every rebuild recompiles everything. See docs/wsl.md.

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { connect } from "node:net";
import { dirname, join } from "node:path";

// biome-ignore-start lint/suspicious/noUndeclaredEnvVars: this bridge never runs under turbo
const MIRROR = process.env.STUDIO_NATIVE_MIRROR;
const SOURCE = process.env.STUDIO_NATIVE_SOURCE;
const PERIOD_MS = Number(process.env.STUDIO_MIRROR_MS ?? 700);
// biome-ignore-end lint/suspicious/noUndeclaredEnvVars: see above

const ROBOCOPY = "/mnt/c/Windows/System32/Robocopy.exe";
const CMD = "/mnt/c/Windows/System32/cmd.exe";

// Everything derived stays on the host: the mirror keeps its OWN node_modules, and no build output travels back.
// `dist` is NOT on this list — engine/st0-tray/dist is the tray's web assets, tracked by git, and tauri stops without it.
// `.cache` IS, and load-bearingly: `/MIR` purges whatever the source lacks, and that directory holds the tray's own
// stdout — the only trace of a panic thrown before the merged log exists — plus the vendored node download.
const SKIP = [
  "node_modules",
  ".git",
  "build",
  "target",
  "out",
  ".cache",
  ".turbo",
  ".vite",
  ".claude",
];

/** One mirror pass over `sub` (the whole tree when empty); true when something moved. */
function mirrorOnce(sub = "") {
  const r = spawnSync(
    ROBOCOPY,
    [
      SOURCE + sub,
      MIRROR + sub,
      "/MIR",
      "/XD",
      ...SKIP,
      "/NFL",
      "/NDL",
      "/NJH",
      "/NJS",
      "/R:1",
      "/W:1",
    ],
    // 64 MB: a PURGING pass prints a line per extra directory, and the 1 MB default bursts the
    // moment a large tree leaves the source — which is exactly what renaming a directory does.
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  // A spawn that never ran has no status, and calling that "16" sends the reader to the share.
  if (r.error) throw new Error(`robocopy did not run: ${r.error.message}`);
  // Robocopy answers a BITMASK: 0-7 is success, 8 and up is not. Only bit 1 means COPIED — bit 2
  // is "extras at the destination", which the skipped build output sets on every single pass.
  const code = r.status ?? 16;
  // Its own last words, or the reason is only ever guessed at from the number.
  if (code >= 8)
    throw new Error(
      `robocopy answered ${code}\n${(r.stdout || "").trim().slice(-2000)}`,
    );
  return (code & 1) !== 0;
}

/** Run one command on the host, in the mirror; its output is PIPED — see docs/wsl.md. */
const onHost = (line) =>
  spawn(CMD, ["/c", `cd /d ${MIRROR} && ${line}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });

// The mirror as THIS side sees it — C:\studio-native → /mnt/c/studio-native — which is where a
// link into it points: the host's node_modules holds WSL symlinks with /mnt/c targets, written
// by the npm ci that was run from the distro (docs/wsl.md).
const mirrorWsl = `/mnt/${MIRROR[0].toLowerCase()}${MIRROR.slice(2).replace(/\\/g, "/")}`;

/** Create the node_modules link a NEW workspace package lacks. The host's node_modules is
 *  installed once and skipped by the mirror, so a package added to the workspaces since has no
 *  link there, and the first native import of it dies with ERR_MODULE_NOT_FOUND — this bridge
 *  is the only thing that runs between the two, so the heal lives here. One link per
 *  package.json the mirror holds, named by that manifest, pointing at the mirrored folder —
 *  the same shape npm's own links have. Existing links are never touched, and npm is never
 *  run: this covers new PACKAGES; new third-party deps are still npm ci's job (docs/wsl.md). */
function ensureWorkspaceLinks(log) {
  let created = 0;
  for (const root of ["packages", "commons/packages"]) {
    let dirs;
    try {
      dirs = readdirSync(join(mirrorWsl, root), { withFileTypes: true });
    } catch {
      continue; // a root the mirror has not got yet — a later pass may
    }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      let name;
      try {
        name = JSON.parse(
          readFileSync(join(mirrorWsl, root, d.name, "package.json"), "utf8"),
        ).name;
      } catch {
        continue; // half-written or not a workspace package
      }
      if (typeof name !== "string" || !name) continue;
      const link = join(mirrorWsl, "node_modules", name);
      if (existsSync(link)) continue;
      try {
        mkdirSync(dirname(link), { recursive: true });
        symlinkSync(join(mirrorWsl, root, d.name), link, "dir");
        created += 1;
        log(`linked ${name} into the host's node_modules`);
      } catch (e) {
        log(`✖ could not link ${name}: ${e.message}`);
      }
    }
  }
  return created;
}

/** One task on the host: what to run there, which subtrees stay in step, and how to end it. */
export async function runBridge({
  name = "native",
  command = "node scripts\\dev-native.mjs",
  // Only engine/ by default: the tray bundles its TS at startup, so nothing else need travel.
  watch = ["\\engine"],
  stopCommand = "node engine\\st0-tray\\scripts\\restart-tray.mjs --stop",
  periodMs = PERIOD_MS,
  // Set when the host task has no watcher of its own worth trusting — see ../docs/wsl.md.
  restartOnChange = false,
  // The port the host task listens on, which is the only way from here to know it has STARTED.
  // Without one a restart cannot be serialised, and the race in ../docs/wsl.md is open.
  readyPort = 0,
} = {}) {
  if (!MIRROR || !SOURCE)
    throw new Error(
      "the bridge needs $STUDIO_NATIVE_MIRROR and $STUDIO_NATIVE_SOURCE — see docs/wsl.md",
    );
  const log = (msg) => console.log(`${name} | ${msg}`);

  log(`mirroring ${SOURCE} → ${MIRROR}`);
  mirrorOnce();
  ensureWorkspaceLinks(log);

  /** Resolve when `port` answers, or when the child gives up first — WSL reaches the host's
   *  ports through localhost forwarding, so this works from the distro. */
  const awaitReady = (port, c) =>
    new Promise((resolve) => {
      let done = false;
      const finish = (how) => {
        if (!done) {
          done = true;
          resolve(how);
        }
      };
      c.once("exit", () => finish("exited"));
      const until = Date.now() + 90_000;
      const probe = () => {
        if (done) return;
        if (Date.now() > until) return finish("timeout");
        const socket = connect({ port, host: "127.0.0.1" });
        socket.once("connect", () => {
          socket.destroy();
          finish("listening");
        });
        socket.once("error", () => {
          socket.destroy();
          setTimeout(probe, 200);
        });
      };
      probe();
    });

  let stopping = false;
  // A restart asked for while the task is still STARTING is queued, never launched — docs/wsl.md.
  let starting = false;
  let pending = false;
  let child = null;
  let resolveExit;
  const exited = new Promise((r) => {
    resolveExit = r;
  });

  // What runs on the host outlives an interop kill, so it is ended over there rather than here.
  const endOnHost = () => {
    const r = spawnSync(CMD, ["/c", `cd /d ${MIRROR} && ${stopCommand}`], {
      encoding: "utf8",
    });
    for (const line of `${r.stdout ?? ""}${r.stderr ?? ""}`.split(/\r?\n/))
      if (line.trim()) log(line.trim());
  };

  const launch = () => {
    // Always clear first: a previous session may have left something on the host holding the port.
    endOnHost();
    const c = onHost(command);
    // Forwarded through `log`, so the host's lines and ours land in one ORDER — docs/wsl.md.
    for (const stream of [c.stdout, c.stderr])
      stream.setEncoding("utf8").on("data", (d) => {
        for (const line of d.split(/\r?\n/))
          if (line.trim()) log(line.trimEnd());
      });
    child = c;
    // A replaced child's exit is a restart, not the task ending, so identity decides and not a flag.
    c.on("exit", (code) => {
      if (stopping || child !== c) return;
      stop();
      resolveExit(code ?? 0);
    });

    if (!readyPort) return;
    starting = true;
    void awaitReady(readyPort, c).then((how) => {
      if (stopping || child !== c) return;
      starting = false;
      // Said out loud: a guard that only speaks when it fails cannot be seen working.
      if (how === "listening") log(`up on ${readyPort}`);
      if (how === "timeout")
        log(
          `✖ nothing answered on ${readyPort} after 90s — restarting anyway from here`,
        );
      if (!pending) return;
      pending = false;
      log("applying the changes that arrived while it was starting…");
      restart();
    });
  };

  const restart = () => {
    // The one that is STARTING holds no port yet, so the stopper cannot see it: launching a second
    // one now leaves both alive and the loser dies on EADDRINUSE — ../docs/wsl.md.
    if (starting) {
      if (!pending)
        log("still starting — this change will be applied once it is up");
      pending = true;
      return;
    }
    const old = child;
    child = null;
    old?.kill();
    launch();
  };

  const timer = setInterval(() => {
    let moved = false;
    for (const sub of watch) {
      try {
        if (mirrorOnce(sub)) {
          moved = true;
          log(`${sub} mirrored`);
        }
      } catch (err) {
        log(`✖ ${err.message}`);
      }
    }
    ensureWorkspaceLinks(log);
    if (moved && restartOnChange) {
      log("sources changed, restarting on the host…");
      restart();
    }
  }, periodMs);

  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    child?.kill();
    log("stopping on the host…");
    endOnHost();
  };
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => stop());

  launch();
  return await exited;
}
