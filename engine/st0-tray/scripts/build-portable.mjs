#!/usr/bin/env node
// build-portable.mjs — `npm run engine:portable`: ONE Windows .exe carrying the engine, the
// tray, the supervisor and the file service. What the app carries is staged by
// build-engine.mjs, so that list has a single definition; this script only lays the pieces
// out flat, zips them, and appends the archive to the launcher in portable-stub.rs.
// Windows only. See docs/buildPortable.md.

import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildNumber,
  distDir,
  hostTriple,
  run,
  tauriCmd,
} from "./buildTools.mjs";

const here = dirname(fileURLToPath(import.meta.url)); // engine/st0-tray/scripts
const trayDir = dirname(here);
const repo = join(trayDir, "..", "..");
const engineDir = join(repo, "engine", "st0-engine");
const OUT = distDir(repo); //          <repo>/dist — the monorepo's output root
const PORTABLE = join(OUT, "portable"); // working space, not a deliverable (WORK_DIRS)
const APP = join(PORTABLE, "app"); //    the layout the launcher unpacks, verbatim

const SYSTEM32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

if (process.platform !== "win32")
  fail(
    "the portable build is Windows-only — elsewhere `npm run engine:build` is the deliverable.",
  );

// `--skip-engine`: reuse whatever is already under engine/st0-engine/build (docs/buildPortable.md).
const skipEngine = process.argv.includes("--skip-engine");
// `--dir-only`: stop at out/portable/app, the unpacked layout, without packing it.
const dirOnly = process.argv.includes("--dir-only");

const BUILD = buildNumber();
if (BUILD.length > 16)
  fail(`the build stamp ${BUILD} does not fit the trailer.`);

const PRESET = process.env.STUDIO_ENGINE_PRESET || "windows-msvc";

// ── 1. the C++ engine ──────────────────────────────────────────────────────────
if (!skipEngine) {
  console.log(`\n=== engine (${PRESET}) ===`);
  run("node", [join("scripts", "build.mjs"), PRESET], engineDir);
}

// ── 2. everything the app carries, staged by the one script that defines it ────
console.log("\n=== staging what the app carries ===");
run("node", [join("scripts", "build-engine.mjs"), "--sidecar-only"], trayDir);

// ── 3. the tray, without an installer ──────────────────────────────────────────
console.log("\n=== tray (release, no bundle) ===");
const tauri = tauriCmd(trayDir);
run(tauri.cmd, [...tauri.args, "build", "--no-bundle"], trayDir, {
  CI: "true",
  STUDIO_BUILD: BUILD,
});

// ── 4. the flat layout the launcher will unpack ────────────────────────────────
console.log("\n=== layout ===");
const release = join(trayDir, "src-tauri", "target", "release");
const trayExe = join(release, "st0-tray.exe");
if (!existsSync(trayExe))
  fail(`no tray executable at ${trayExe} — check the build output above.`);

rmSync(APP, { recursive: true, force: true });
mkdirSync(APP, { recursive: true });
cpSync(trayExe, join(APP, "st0-tray.exe"));

// Whatever the toolchain left beside it — a WebView2 loader on the toolchains that do not link it in.
for (const name of readdirSync(release))
  if (name.toLowerCase().endsWith(".dll"))
    cpSync(join(release, name), join(APP, name));

// The sidecars, with the triple taken back off: the tray looks for `st0-supervisor.exe`, not `st0-supervisor-<triple>.exe`.
const triple = hostTriple();
const binaries = join(trayDir, "src-tauri", "binaries");
for (const name of readdirSync(binaries))
  cpSync(join(binaries, name), join(APP, name.replace(`-${triple}`, "")));

// `resources/` keeps its name: that is where the supervisor finds ONNX Runtime and FaustPlugin.cpp its libraries.
cpSync(join(trayDir, "src-tauri", "resources"), join(APP, "resources"), {
  recursive: true,
  dereference: true,
});

for (const name of readdirSync(APP)) console.log(`  ${name}`);
if (dirOnly) {
  console.log(
    `\n✔ unpacked layout in ${APP} — st0-tray.exe runs from there as it stands.`,
  );
  process.exit(0);
}

// ── 5. the archive ─────────────────────────────────────────────────────────────
console.log("\n=== archive ===");
const archive = join(PORTABLE, "app.zip");
rmSync(archive, { force: true });
// System32's bsdtar BY PATH: it writes .zip from the extension, and a bare `tar` may be GNU tar.
run(
  join(SYSTEM32, "tar.exe"),
  ["-a", "-c", "-f", archive, "-C", APP, "."],
  PORTABLE,
);

// ── 6. the launcher ────────────────────────────────────────────────────────────
console.log("\n=== launcher ===");
const stub = join(PORTABLE, "stub.exe");
run(
  "rustc",
  [
    "--edition",
    "2021",
    "-C",
    "opt-level=2",
    "-o",
    stub,
    join(here, "portable-stub.rs"),
  ],
  PORTABLE,
);

// ── 7. launcher + archive + trailer = the one executable ───────────────────────
const exeOut = join(OUT, `st0-portable_${BUILD}.exe`);
rmSync(exeOut, { force: true });
cpSync(stub, exeOut);

const payloadSize = statSync(archive).size;
const out = openSync(exeOut, "a");
const src = openSync(archive, "r");
const buf = Buffer.alloc(1 << 20); // copied in chunks: the payload is hundreds of megabytes
for (;;) {
  const n = readSync(src, buf, 0, buf.length, null);
  if (!n) break;
  writeSync(out, buf, 0, n);
}
closeSync(src);

// The trailer portable-stub.rs reads back: the build id, the payload length, the magic.
const trailer = Buffer.alloc(32);
trailer.write(BUILD.padEnd(16, " "), 0, "ascii");
trailer.writeBigUInt64LE(BigInt(payloadSize), 16);
trailer.write("ST0PORT1", 24, "ascii");
writeSync(out, trailer);
closeSync(out);

rmSync(archive, { force: true });

const size = statSync(exeOut).size;
console.log(`\n✔ ${exeOut}  (${(size / 1e6).toFixed(0)} MB, build ${BUILD})`);
console.log(
  "  Double-click it: the first run unpacks into %LOCALAPPDATA%\\st0\\portable\\" +
    `${BUILD} and starts the tray; later runs go straight there.`,
);
