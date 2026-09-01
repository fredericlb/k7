// run-tests.mjs — the C++ suite, as a turbo task. Builds the `studio_*` ctest targets in whichever
// preset this platform uses, then runs them.
//
// Two things it refuses to do: guess a preset (the name comes from the platform, or
// $STUDIO_MOTEUR_PRESET), and configure one. Configuring fetches Tracktion, JUCE and Faust — minutes
// and a network — so an unconfigured tree SKIPS, loudly, with the command to fix it. That makes this
// a non-blocking check in the sense docs/dev.md already uses for lint:dead.
//
// Why the `^studio_` filter is load-bearing, and what the skip costs: ../../../docs/tests.md.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/** Which preset this platform builds under — the same three names package.json's build:* use. */
const PRESET =
  process.env.STUDIO_MOTEUR_PRESET ||
  { win32: "windows-msvc", darwin: "macos-clang" }[process.platform] ||
  "dev-gcc";

const buildDir = join(ROOT, "build", PRESET);

/** The configure step's own record of itself; absent means nobody has ever built here. */
function readCache() {
  try {
    return readFileSync(join(buildDir, "CMakeCache.txt"), "utf8");
  } catch {
    return null;
  }
}

const cache = readCache();
if (cache === null) {
  console.log(`\n  SKIPPED — engine/st0-engine has no build/${PRESET}.`);
  console.log("  The C++ tests need a configured tree; configuring fetches Tracktion and Faust.");
  console.log(`\n    cmake --preset ${PRESET}\n`);
  console.log("  Then `npm run test --workspace st0-engine` runs them. See docs/tests.md.\n");
  process.exit(0);
}

const cacheValue = (key) =>
  cache.match(new RegExp(`^${key}:[^=]*=(.*)$`, "m"))?.[1] ?? "";

// A Visual Studio or Xcode tree carries its configurations here; Ninja leaves it empty and uses
// CMAKE_BUILD_TYPE instead, which is why the flag has to be conditional rather than always passed.
const multiConfig = cacheValue("CMAKE_CONFIGURATION_TYPES") !== "";
const config = multiConfig
  ? cacheValue("CMAKE_BUILD_TYPE") || "RelWithDebInfo"
  : "";
// cmake spells it --config and ctest spells it -C; both take nothing at all under Ninja.
const buildFlags = multiConfig ? ["--config", config] : [];
const ctestFlags = multiConfig ? ["-C", config] : [];

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT, shell: false });
  if (r.error) {
    console.error(`\n  ${cmd} could not be run: ${r.error.message}\n`);
    process.exit(1);
  }
  return r.status ?? 1;
};

// Two filters, and both are load-bearing. `^studio_` because this project also registers
// Tracktion's OWN vendored Benchmarks and TestRunner, which are not ours and are not even built.
// `-LE slow` because the two Tracktion-linked targets cost minutes — pass --all to include them.
const all = process.argv.includes("--all");
const filters = ["-R", "^studio_", ...(all ? [] : ["-LE", "slow"])];

// The targets come from ctest rather than a list here, so adding one to tests/CMakeLists.txt is enough.
const listed = spawnSync(
  "ctest",
  ["--test-dir", buildDir, ...ctestFlags, "-N", ...filters],
  { encoding: "utf8", cwd: ROOT },
);
if (listed.error) {
  console.error(`\n  ctest could not be run: ${listed.error.message}\n`);
  process.exit(1);
}
const targets = [
  ...listed.stdout.matchAll(/^\s*Test\s+#\d+:\s+(studio_\S+)$/gm),
].map((m) => m[1]);

if (targets.length === 0) {
  console.error("\n  No studio_* tests registered — is build/" + PRESET + " stale?\n");
  process.exit(1);
}

console.log(
  `\n  st0-engine: ${targets.length} C++ test targets, preset ${PRESET}${all ? "" : " (--all adds the Tracktion-linked ones)"}\n`,
);

const built = run("cmake", [
  "--build",
  buildDir,
  ...buildFlags,
  "--target",
  ...targets,
]);
if (built !== 0) process.exit(built);

process.exit(
  run("ctest", [
    "--test-dir",
    buildDir,
    ...ctestFlags,
    ...filters,
    "--output-on-failure",
  ]),
);
