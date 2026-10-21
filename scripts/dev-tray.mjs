#!/usr/bin/env node
// dev-tray.mjs — the native half of the dev session: builds the C++ engine, the native supervisor, k7's backend bundle
// and the tray, runs the tray on the repo's own builds, then watches the engine, the supervisor and the tray's Rust
// and rebuilds+restarts on save. One process owns every watch because every rebuild needs the SAME tree stopped
// first — a running image cannot be relinked on Windows. See docs/dev.md.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, watch } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stopAll } from "../engine/scripts/devEngine.mjs";
import {
  buildSupervisor,
  CROSS,
  findSupervisor,
} from "../engine/scripts/supervisorBuild.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = join(repo, "engine", "k7-runtime");
const supervisorDir = join(repo, "engine", "k7-supervisor");
const trayDir = join(repo, "apps", "k7-tray");
const tauriDir = join(trayDir, "src-tauri");
// The backend bundle the dev tray runs, rebuilt at every start of the task; gitignored.
const bundleDir = join(trayDir, ".dev", "backend");

// Long enough that a formatter's write burst is one rebuild, short enough to feel like a save.
const DEBOUNCE_MS = 500;

const log = (msg) => console.log(`tray | ${msg}`);
const shell = process.platform === "win32"; // npm and cargo are .cmd shims or PATH lookups there

function run(cmd, args, cwd, what) {
  console.log(`\n▸ ${cmd} ${args.join(" ")}\n`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell });
  if (r.status !== 0) throw new Error(`${what} failed (exit ${r.status})`);
}

// ── what each target is, and how it is rebuilt ────────────────────────────────

// `dirs` are watch roots and `match` filters by BASE name — see ../docs/dev.md.

const isCxx = (base) => /\.(cpp|h|hpp|mm)$/.test(base);
const cmakeFiles = (base) =>
  base === "CMakeLists.txt" || base === "CMakePresets.json";

const TARGETS = {
  // The C++ that ends up in k7-runtime; tests/ is deliberately out (../docs/dev.md).
  "k7-runtime": {
    dirs: [
      { path: join(engineDir, "engine"), recursive: true, match: isCxx },
      { path: join(engineDir, "server"), recursive: true, match: isCxx },
      { path: engineDir, recursive: false, match: cmakeFiles },
    ],
    build: buildEngine,
  },
  // The supervisor that runs the engine: a separate CMake project, so its build never touches the engine's.
  "k7-supervisor": {
    dirs: [
      { path: join(supervisorDir, "src"), recursive: true, match: isCxx },
      { path: supervisorDir, recursive: false, match: cmakeFiles },
    ],
    build: () => buildSupervisor(repo),
  },
  // The tray itself: a cargo build, incremental, seconds once the dependencies are compiled.
  "k7-tray": {
    dirs: [
      {
        path: join(tauriDir, "src"),
        recursive: true,
        match: (b) => b.endsWith(".rs"),
      },
      {
        path: tauriDir,
        recursive: false,
        match: (b) => b === "Cargo.toml" || b === "tauri.conf.json",
      },
    ],
    build: () => {
      // tauri.conf.json names resources/, which only stage.mjs fills: the dev tray reads the repo's builds instead.
      mkdirSync(join(tauriDir, "resources"), { recursive: true });
      run("cargo", ["build"], tauriDir, "the tray build");
    },
  },
};

// Rebuild order: the slow one first, so a broken engine never costs the cheaper rebuilds (../docs/dev.md).
const ORDER = ["k7-runtime", "k7-supervisor", "k7-tray"];

/** Delegated to the engine's own build:* scripts, so this holds no CMake knowledge. */
function buildEngine() {
  const script = { win32: "build:win", darwin: "build:mac" }[process.platform];
  if (!script) {
    log(
      "no engine build script for this platform — leaving engine/k7-runtime/build as it is",
    );
    return;
  }
  run(
    "npm",
    ["run", script, "--workspace", "k7-runtime"],
    repo,
    "the engine build",
  );
  // A build reporting SUCCESS without replacing the image is what this guards (../docs/dev.md).
  const after = engineBinary();
  if (after && statSync(after).mtimeMs < newestSource("k7-runtime"))
    throw new Error(
      `the engine build reported success but ${basename(after)} is still older than its ` +
        "sources — something is holding it open (a surviving engine? see stopAll)",
    );
}

/** k7's frontend, then the backend bundle with it inside — what the tray serves (apps/k7-tray/scripts/stage.mjs). */
function buildBundle() {
  run(
    "npm",
    ["exec", "--workspace", "k7-frontend", "--", "vite", "build"],
    repo,
    "the frontend build",
  );
  run(
    "node",
    [join(repo, "apps", "k7", "backend", "scripts", "bundle.mjs"), bundleDir],
    repo,
    "the backend bundle",
  );
}

// ── is a binary older than the sources it came from? ─────────────────────────

/** The freshest built engine binary, Debug last (mirrors build-engine.mjs's findEngineBinary). */
function engineBinary() {
  const build = join(engineDir, "build");
  if (!existsSync(build)) return null;
  const names = ["k7-runtime.exe", "k7-runtime"];
  const found = [];
  // A phone's build sits beside this machine's; running it here fails to spawn (engine/scripts/supervisorBuild.mjs).
  for (const preset of readdirSync(build).filter((p) => !CROSS.test(p)))
    for (const cfg of ["", "Release", "RelWithDebInfo", "Debug"])
      for (const name of names) {
        const p = join(build, preset, cfg, name);
        if (existsSync(p) && statSync(p).isFile())
          found.push({ path: p, debug: cfg === "Debug" });
      }
  found.sort(
    (a, b) =>
      Number(a.debug) - Number(b.debug) ||
      statSync(b.path).mtimeMs - statSync(a.path).mtimeMs,
  );
  return found[0]?.path ?? null;
}

/** The dev tray, as cargo builds it. */
const trayBinary = () =>
  join(
    tauriDir,
    "target",
    "debug",
    process.platform === "win32" ? "k7-tray.exe" : "k7-tray",
  );

/** The newest mtime under a target's watch roots — the same files the watcher reacts to. */
function newestSource(target) {
  let newest = 0;
  const visit = (dir, recursive, match) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) visit(p, true, match);
      } else if (match(entry.name)) {
        newest = Math.max(newest, statSync(p).mtimeMs);
      }
    }
  };
  for (const { path, recursive, match } of TARGETS[target].dirs)
    visit(path, recursive, match);
  return newest;
}

const stale = (bin, target) =>
  !bin || !existsSync(bin) || statSync(bin).mtimeMs < newestSource(target);

// ── the tray, run on the repo's own builds ────────────────────────────────────

let tray = null;

/** The tray as our child: the bundle and the supervisor named by the overrides its paths.rs reads first. */
function launchTray() {
  const supervisor = findSupervisor(repo);
  if (!supervisor) throw new Error("no supervisor build to run");
  tray = spawn(trayBinary(), [], {
    cwd: tauriDir,
    stdio: "inherit",
    env: {
      ...process.env,
      K7_BACKEND_BUNDLE: bundleDir,
      STUDIO_ENGINE_HOST_CMD: supervisor,
    },
  });
  tray.on("exit", (code) => {
    if (tray && !stopping)
      log(`the tray exited (code ${code}) — save to restart it`);
    tray = null;
  });
  log(
    `tray up (pid ${tray.pid}) — k7 at http://127.0.0.1:18789, the merged log in ~/.k7/.studio.log`,
  );
}

/** Ours, then every tray, supervisor and engine on the machine: a survivor holds a binary a relink replaces. */
async function stopEverything() {
  if (tray) {
    const t = tray;
    tray = null;
    t.kill();
  }
  await stopAll();
}

// ── the rebuild cycle ─────────────────────────────────────────────────────────

const dirty = new Set();
let busy = false;
let timer = null;

function touch(target, file) {
  if (!dirty.has(target)) log(`${target}: ${file}`);
  dirty.add(target);
  clearTimeout(timer);
  timer = setTimeout(kick, DEBOUNCE_MS);
}

// One cycle at a time: a save during a build re-arms this timer rather than racing it.
function kick() {
  if (busy) {
    timer = setTimeout(kick, DEBOUNCE_MS);
    return;
  }
  void cycle();
}

async function cycle() {
  const todo = ORDER.filter((n) => dirty.has(n));
  busy = true;
  let current = null;
  try {
    if (todo.length) log(`rebuilding ${todo.join(" + ")}`);
    await stopEverything(); // frees the locks a relink would otherwise hit
    for (const name of todo) {
      current = name;
      dirty.delete(name); // before the build, not after: a save made DURING it must still count
      TARGETS[name].build();
    }
    current = null;
    launchTray();
  } catch (err) {
    if (current) dirty.add(current); // failed — retried on the next save, never in a loop
    console.error(`\ntray | ✖ ${err.message}`);
    console.error("tray | the tray is stopped — fix and save again.");
  } finally {
    busy = false;
  }
}

// ── start ─────────────────────────────────────────────────────────────────────

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  log("stopping the tray and its engine…");
  try {
    await stopEverything();
  } catch (err) {
    console.error(`tray | ✖ ${err.message}`);
  }
  process.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => void shutdown());

await stopAll(); // whatever a previous session or an installed tray left behind

if (stale(engineBinary(), "k7-runtime")) {
  log("the engine is missing or older than its sources — building it");
  dirty.add("k7-runtime");
}
if (stale(findSupervisor(repo), "k7-supervisor")) {
  log("the supervisor is missing or older than its sources — building it");
  dirty.add("k7-supervisor");
}
if (stale(trayBinary(), "k7-tray")) {
  log("the tray is missing or older than its sources — building it");
  dirty.add("k7-tray");
}

// The bundle is k7 itself, whose sources are the whole workspace: built at every start, not watched (../docs/dev.md).
try {
  buildBundle();
} catch (err) {
  // Red in Tilt until restarted: a tray with no backend would only say so on its status line.
  console.error(`\ntray | ✖ ${err.message} — restart the task once it builds.`);
  process.exit(1);
}
await cycle();

for (const [target, { dirs }] of Object.entries(TARGETS))
  for (const { path, recursive, match } of dirs) {
    if (!existsSync(path)) continue;
    try {
      watch(path, { recursive }, (_event, filename) => {
        if (filename && match(basename(filename)))
          touch(target, basename(filename));
      }).unref(); // the signal handlers hold the loop open, not the watchers
    } catch {
      // No recursive watch on this platform (Linux) — dev convenience, not a feature.
      log(`cannot watch ${path} on this platform — no auto-rebuild for it`);
    }
  }

log(
  "watching the engine, the supervisor and the tray — save to rebuild and restart",
);
setInterval(() => {}, 1 << 30); // the watchers are unref'd, so hold the process open ourselves
