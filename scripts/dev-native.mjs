#!/usr/bin/env node
// dev-native.mjs — the native half of the dev session: builds the C++ engine and the tray,
// launches the tray, then watches both source trees and rebuilds+restarts on save. One
// process owns both watches because both rebuilds need the SAME tray stopped first — a
// running image cannot be relinked on Windows. See docs/dev.md.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, watch } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDevApp,
  launch,
  stopAll,
} from "../engine/capot/scripts/trayProcess.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = join(repo, "engine", "moteur");

// Long enough that a formatter's write burst is one rebuild, short enough to feel like a save.
const DEBOUNCE_MS = 500;

const log = (msg) => console.log(`native | ${msg}`);

// ── what each target is, and how it is rebuilt ────────────────────────────────

// `dirs` are watch roots and `match` filters by BASE name — see ../docs/dev.md.

const isCxx = (base) => /\.(cpp|h|hpp|mm)$/.test(base);

const TARGETS = {
  // The C++ that ends up in studio-moteur; tests/ is deliberately out (../docs/dev.md).
  moteur: {
    dirs: [
      { path: join(engineDir, "engine"), recursive: true, match: isCxx },
      { path: join(engineDir, "server"), recursive: true, match: isCxx },
      {
        path: engineDir,
        recursive: false,
        match: (base) =>
          base === "CMakeLists.txt" || base === "CMakePresets.json",
      },
    ],
    build: buildEngine,
  },
  // The tray; build.rs and tauri.conf.json are in because cargo re-runs on both.
  capot: {
    dirs: [
      {
        path: join(repo, "engine", "capot", "src-tauri", "src"),
        recursive: true,
        match: (base) => base.endsWith(".rs"),
      },
      {
        path: join(repo, "engine", "capot", "src-tauri"),
        recursive: false,
        match: (base) =>
          base === "Cargo.toml" ||
          base === "build.rs" ||
          base === "tauri.conf.json",
      },
    ],
    build: buildDevApp,
  },
};

// Rebuild order: the slow one first, so a broken C++ never costs a cargo run (../docs/dev.md).
const ORDER = ["moteur", "capot"];

/** Delegated to the moteur's own build:* scripts, so this holds no CMake knowledge. */
function buildEngine() {
  const script = { win32: "build:win", darwin: "build:mac" }[process.platform];
  if (!script) {
    log(
      "no engine build script for this platform — leaving engine/moteur/build as it is",
    );
    return;
  }
  console.log(`\n▸ npm run ${script} --workspace moteur\n`);
  const r = spawnSync("npm", ["run", script, "--workspace", "moteur"], {
    cwd: repo,
    stdio: "inherit",
    shell: process.platform === "win32", // npm is a .cmd shim here
  });
  if (r.status !== 0)
    throw new Error(`the engine build failed (exit ${r.status})`);

  // A build reporting SUCCESS without replacing the image is what this guards (../docs/dev.md).
  const after = engineBinary();
  if (after && statSync(after).mtimeMs < newestSource("moteur"))
    throw new Error(
      `the engine build reported success but ${basename(after)} is still older than its ` +
        "sources — something is holding it open (a surviving engine? see stopAll)",
    );
}

// ── is the engine binary older than the sources it came from? ────────────────

// Asked once, at startup, and only then — see ../docs/dev.md.

/** The freshest built engine binary, Debug last (mirrors build-engine.mjs's findEngineBinary). */
function engineBinary() {
  const build = join(engineDir, "build");
  if (!existsSync(build)) return null;
  const names = ["studio-moteur.exe", "studio-moteur"];
  const found = [];
  for (const preset of readdirSync(build))
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
  if (!todo.length) return;
  busy = true;
  let current = null;
  try {
    log(`rebuilding ${todo.join(" + ")}`);
    await stopAll(); // frees the locks a relink would otherwise hit
    for (const name of todo) {
      current = name;
      dirty.delete(name); // before the build, not after: a save made DURING it must still count
      TARGETS[name].build();
    }
    current = null;
    console.log(await launch());
    log("up");
  } catch (err) {
    if (current) dirty.add(current); // failed — retried on the next save, never in a loop
    console.error(`\nnative | ✖ ${err.message}`);
    console.error("native | the tray is stopped — fix and save again.");
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
  log("stopping the tray…");
  try {
    await stopAll();
  } catch (err) {
    console.error(`native | ✖ ${err.message}`);
  }
  process.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => void shutdown());

await stopAll(); // whatever a previous session or an installed bundle left behind

const bin = engineBinary();
if (!bin) {
  log("no engine binary yet — building it (this one is long)");
  dirty.add("moteur");
} else if (statSync(bin).mtimeMs < newestSource("moteur")) {
  log("the engine is older than its sources — rebuilding");
  dirty.add("moteur");
}
dirty.add("capot"); // always: a cargo no-op is seconds, and it is what guarantees out/dev matches src

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

log("watching engine/moteur and engine/capot — save to rebuild and restart");
setInterval(() => {}, 1 << 30); // the watchers are unref'd, so hold the process open ourselves
