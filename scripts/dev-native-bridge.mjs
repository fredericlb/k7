#!/usr/bin/env node
// dev-native-bridge.mjs — the native task when the sources live in WSL and the MSVC
// toolchain does not. It mirrors the tree onto the host's NTFS and runs dev-native.mjs THERE,
// unchanged, so the whole native half keeps the shape docs/dev.md describes. Nothing is built
// across the share: MSBuild lowercases the dependency it tracks, which a case-sensitive
// filesystem then fails to find, and every rebuild recompiles everything. See docs/wsl.md.

import { spawn, spawnSync } from "node:child_process";

// biome-ignore-start lint/suspicious/noUndeclaredEnvVars: this bridge never runs under turbo
const MIRROR = process.env.STUDIO_NATIVE_MIRROR;
const SOURCE = process.env.STUDIO_NATIVE_SOURCE;
const PERIOD_MS = Number(process.env.STUDIO_MIRROR_MS ?? 700);
// biome-ignore-end lint/suspicious/noUndeclaredEnvVars: see above

const ROBOCOPY = "/mnt/c/Windows/System32/Robocopy.exe";
const CMD = "/mnt/c/Windows/System32/cmd.exe";

// Everything derived stays on the host: the mirror keeps its OWN node_modules, and no build output travels back.
// `dist` is NOT on this list: apps/st0-desktop/dist/main.cjs is the desktop app's main process,
// esbuilt by the `st0-desktop` Tilt resource IN THE DISTRO, and the mirror is how it reaches the
// host that actually runs Electron.
const SKIP = [
  "node_modules",
  ".git",
  "build",
  "target",
  "out",
  ".turbo",
  ".vite",
  ".claude",
  // Per-MACHINE derived state: a dev pidfile, the app's own stdout, and vendored node
  // downloads for one platform. Mirroring it put the DISTRO's crash into the log the Windows
  // side tails, so a failure there was diagnosed with a Linux dynamic-linker error.
  ".cache",
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
    { encoding: "utf8" },
  );
  // Robocopy answers a BITMASK: 0-7 is success, 8 and up is not. Only bit 1 means COPIED — bit 2
  // is "extras at the destination", which the skipped build output sets on every single pass.
  const code = r.status ?? 16;
  if (code >= 8)
    throw new Error(`robocopy answered ${code} — is ${SOURCE} reachable?`);
  return (code & 1) !== 0;
}

/** Run one command on the host, in the mirror; its output is PIPED — see docs/wsl.md. */
const onHost = (line) =>
  spawn(CMD, ["/c", `cd /d ${MIRROR} && ${line}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });

/** One task on the host: what to run there, which subtrees stay in step, and how to end it. */
export async function runBridge({
  name = "native",
  command = "node scripts\\dev-native.mjs",
  // Two subtrees, and the second is not optional since the app left engine/: the C++ sources
  // the host compiles, AND apps/st0-desktop, whose dist/main.cjs is esbuilt in the DISTRO
  // and is the very thing the host runs. Watching engine/ alone would mirror a stale app
  // forever, with every save appearing to do nothing.
  watch = ["\\engine", "\\apps\\st0-desktop"],
  stopCommand = "node apps\\st0-desktop\\scripts\\restart-app.mjs --stop",
  periodMs = PERIOD_MS,
  // Set when the host task has no watcher of its own worth trusting — see ../docs/wsl.md.
  restartOnChange = false,
} = {}) {
  if (!MIRROR || !SOURCE)
    throw new Error(
      "the bridge needs $STUDIO_NATIVE_MIRROR and $STUDIO_NATIVE_SOURCE — see docs/wsl.md",
    );
  const log = (msg) => console.log(`${name} | ${msg}`);

  log(`mirroring ${SOURCE} → ${MIRROR}`);
  mirrorOnce();

  let stopping = false;
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
      stop(code ?? 0);
    });
  };

  const restart = () => {
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
    if (moved && restartOnChange) {
      log("sources changed, restarting on the host…");
      restart();
    }
  }, periodMs);

  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    child?.kill();
    log("stopping on the host…");
    endOnHost();
    // The ONE place `exited` settles, or a signal leaves the top-level await pending (node exits 13).
    resolveExit(code);
  };
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => stop());

  launch();
  return await exited;
}
