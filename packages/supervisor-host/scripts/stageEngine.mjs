// stageEngine.mjs — copy the newest engine and supervisor builds into an app's staging `bin/`, with what they load beside them.
// The supervisor finds the engine beside itself, the engine its `faust-libs/`, and the supervisor its onnxruntime.

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";

const exe = (n) => (process.platform === "win32" ? `${n}.exe` : n);
// The presets that build for a phone, whose binaries a desktop app cannot run.
const CROSS = /^(android|ios)-/;

/** The newest build of a CMake target under engine/<project>/build/<preset>/[<config>/], Debug last. */
function newestBuild(repo, project, name) {
  const build = join(repo, "engine", project, "build");
  const found = [];
  if (existsSync(build))
    // A multi-config generator (Visual Studio) puts the binary one level down; a phone's preset is never staged.
    for (const preset of readdirSync(build).filter((p) => !CROSS.test(p)))
      for (const cfg of ["", "Release", "RelWithDebInfo", "Debug"]) {
        const path = join(build, preset, cfg, exe(name));
        if (existsSync(path) && statSync(path).isFile())
          found.push({ path, debug: cfg === "Debug" });
      }
  found.sort(
    (a, b) =>
      Number(a.debug) - Number(b.debug) ||
      statSync(b.path).mtimeMs - statSync(a.path).mtimeMs,
  );
  if (!found[0])
    throw new Error(`no build of ${name} under ${build} — build it first`);
  return found[0].path;
}

/** The Faust `.lib` files the engine's CMake fetched, as the newest preset's CMakeCache names them. */
function faustLibs(repo) {
  const build = join(repo, "engine", "k7-runtime", "build");
  const found = readdirSync(build)
    .map((preset) => join(build, preset, "CMakeCache.txt"))
    .filter((cache) => existsSync(cache))
    .map((cache) =>
      /^STUDIO_FAUST_LIBS:[A-Z]+=(.*)$/m
        .exec(readFileSync(cache, "utf8"))?.[1]
        ?.trim(),
    )
    .filter((dir) => dir && existsSync(join(dir, "stdfaust.lib")));
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!found[0])
    throw new Error(
      "no Faust libraries named by any engine/k7-runtime/build/*/CMakeCache.txt",
    );
  return found[0];
}

/** Fill `bin` (created) from the checkout at `repo`, or from `$STUDIO_PREBUILT_BIN`, a bin/ staged elsewhere (CI's engines job). */
export function stageEngine({ repo, bin }) {
  mkdirSync(bin, { recursive: true });
  const prebuilt = process.env.STUDIO_PREBUILT_BIN;
  if (prebuilt) {
    if (!existsSync(join(prebuilt, exe("k7-supervisor"))))
      throw new Error(`no k7-supervisor in STUDIO_PREBUILT_BIN=${prebuilt}`);
    cpSync(prebuilt, bin, { recursive: true, verbatimSymlinks: true });
    return;
  }
  const supervisor = newestBuild(repo, "k7-supervisor", "k7-supervisor");
  copyFileSync(
    newestBuild(repo, "k7-runtime", "k7-runtime"),
    join(bin, exe("k7-runtime")),
  );
  copyFileSync(supervisor, join(bin, exe("k7-supervisor")));
  const ort = readdirSync(dirname(supervisor)).filter((f) =>
    /^(libonnxruntime.*\.(dylib|so.*)|onnxruntime.*\.dll|DirectML\.dll)$/.test(
      f,
    ),
  );
  // Not fatal: the app runs, and says it cannot cut stems.
  if (!ort.length)
    console.warn(
      "warning: no ONNX Runtime beside the supervisor — the packaged app will not separate stems",
    );
  for (const f of ort)
    cpSync(join(dirname(supervisor), f), join(bin, f), {
      verbatimSymlinks: true,
    });
  const faust = faustLibs(repo);
  mkdirSync(join(bin, "faust-libs"));
  for (const f of readdirSync(faust))
    if (f.endsWith(".lib"))
      copyFileSync(join(faust, f), join(bin, "faust-libs", f));
}
