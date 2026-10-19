// stage.mjs — everything the Xcode project takes from outside it, laid out under build/staged: the engine and the
// supervisor as xcframeworks, NodeMobile and the CA bundle as pinned in pins.json (each checked by its SHA-256),
// Faust's libraries, the shell page as `cap copy` would lay it out, and k7's backend bundled. Run BEFORE Xcode:
// it plans an xcframework's slices when the build starts, so one staged mid-build is not seen.
// Usage: node engine/k7-ios/scripts/stage.mjs [--sim] [--only=engine,supervisor,node,k7x,cacert,faust,shell,backend]
// See engine/k7-runtime/docs/ios.md.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const repo = join(app, "..", "..");
const staged = join(app, "build", "staged");
const frameworks = join(staged, "frameworks");
const resources = join(staged, "resources");
const cache = join(app, "build", "cache");
const pins = JSON.parse(readFileSync(join(here, "pins.json"), "utf8"));

const sim = process.argv.includes("--sim");
const preset = sim ? "ios-sim-arm64" : "ios-arm64";
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg
  ? new Set(onlyArg.slice("--only=".length).split(","))
  : null;
const wanted = (part) => !only || only.has(part);

function run(cmd, args, cwd = repo, env = {}) {
  console.log(`[stage] ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

/** `framework` as the one slice of an xcframework at `out`, which is what the project names. */
function xcframework(framework, out) {
  if (!existsSync(framework))
    throw new Error(`no ${framework}: its build did not produce it`);
  rmSync(out, { recursive: true, force: true });
  run("xcodebuild", [
    "-create-xcframework",
    "-framework",
    framework,
    "-output",
    out,
  ]);
}

/** A pinned download, from the cache when it is already there; a digest that does not match fails the stage. */
async function pinned(name) {
  const pin = pins[name];
  const file = join(cache, pin.url.split("/").pop());
  if (!existsSync(file)) {
    mkdirSync(cache, { recursive: true });
    console.log(`[stage] fetching ${pin.url}`);
    const res = await fetch(pin.url);
    if (!res.ok) throw new Error(`${pin.url}: ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const sum = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (sum !== pin.sha256) {
    rmSync(file);
    throw new Error(`${name}: SHA-256 ${sum}, pinned ${pin.sha256} — refused`);
  }
  return file;
}

mkdirSync(frameworks, { recursive: true });
mkdirSync(resources, { recursive: true });

if (wanted("engine")) {
  run("node", ["engine/k7-runtime/scripts/build.mjs", preset]);
  xcframework(
    join(repo, "engine/k7-runtime/build", preset, "k7runtime.framework"),
    join(frameworks, "k7runtime.xcframework"),
  );
}

if (wanted("supervisor")) {
  run(
    "node",
    [
      "-e",
      "import('./engine/scripts/supervisorBuild.mjs').then((m) => m.buildSupervisor(process.cwd()))",
    ],
    repo,
    {
      STUDIO_SUPERVISOR_PRESET: preset,
    },
  );
  xcframework(
    join(repo, "engine/k7-supervisor/build", preset, "k7supervisor.framework"),
    join(frameworks, "k7supervisor.xcframework"),
  );
}

if (wanted("node")) {
  const zip = await pinned("nodejs-mobile");
  const out = join(cache, "nodejs-mobile");
  rmSync(out, { recursive: true, force: true });
  run("unzip", ["-q", zip, "-d", out]);
  rmSync(join(frameworks, "NodeMobile.xcframework"), {
    recursive: true,
    force: true,
  });
  cpSync(
    join(out, "NodeMobile.xcframework"),
    join(frameworks, "NodeMobile.xcframework"),
    { recursive: true },
  );
}

// The k7x reader as a Node-API addon, linked against NodeMobile's slice, since a JIT-less node has no WebAssembly (packages/k7x/docs/rust.md).
if (wanted("k7x")) {
  const node = join(frameworks, "NodeMobile.xcframework");
  const slice = existsSync(node)
    ? readdirSync(node).find(
        (d) => d.startsWith("ios-") && d.includes("simulator") === sim,
      )
    : undefined;
  if (!slice) throw new Error(`no ${sim ? "simulator " : ""}slice in ${node}: stage "node" first`);
  const target = sim ? "aarch64-apple-ios-sim" : "aarch64-apple-ios";
  run(
    "cargo",
    ["build", "--release", "-p", "k7x-node", "--target", target],
    join(repo, "packages/k7x/rust"),
    { K7X_NODEMOBILE_DIR: join(node, slice), IPHONEOS_DEPLOYMENT_TARGET: "17.0" },
  );
  const fw = join(cache, "k7x.framework");
  rmSync(fw, { recursive: true, force: true });
  mkdirSync(fw, { recursive: true });
  cpSync(
    join(repo, "packages/k7x/rust/target", target, "release/libk7x_node.dylib"),
    join(fw, "k7x"),
  );
  writeFileSync(
    join(fw, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>k7x</string>
<key>CFBundleIdentifier</key><string>se.frediver.k7.k7x</string>
<key>CFBundleName</key><string>k7x</string>
<key>CFBundlePackageType</key><string>FMWK</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleSupportedPlatforms</key><array><string>${sim ? "iPhoneSimulator" : "iPhoneOS"}</string></array>
<key>MinimumOSVersion</key><string>17.0</string>
</dict></plist>
`,
  );
  xcframework(fw, join(frameworks, "k7x.xcframework"));
}

if (wanted("cacert")) {
  cpSync(await pinned("cacert"), join(resources, "cacert.pem"));
}

// Faust's standard libraries, which `import("stdfaust.lib")` opens by path at run time: from the folder the engine's CMake cache names.
if (wanted("faust")) {
  const cacheFile = join(
    repo,
    "engine/k7-runtime/build",
    preset,
    "CMakeCache.txt",
  );
  const line = existsSync(cacheFile)
    ? readFileSync(cacheFile, "utf8")
        .split("\n")
        .find((l) => l.startsWith("STUDIO_FAUST_LIBS:"))
    : undefined;
  const dir = line?.slice(line.indexOf("=") + 1);
  if (!dir || !existsSync(join(dir, "stdfaust.lib")))
    throw new Error(
      `no Faust libraries at '${dir}' — build the engine first (--only=engine)`,
    );
  const out = join(resources, "faust-libs");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".lib")))
    cpSync(join(dir, f), join(out, f));
}

// The shell page Android shows too, laid out as `cap copy` lays it: public/ beside the config Capacitor reads at start.
if (wanted("shell")) {
  const web = join(repo, "engine/k7-android/web");
  run("npm", ["run", "build"], web);
  rmSync(join(resources, "public"), { recursive: true, force: true });
  cpSync(join(web, "dist"), join(resources, "public"), { recursive: true });
  // No npm plugin to load: the app's two are registered by MainViewController, and Capacitor wants the empty list said.
  const config = JSON.parse(
    readFileSync(join(web, "capacitor.config.json"), "utf8"),
  );
  writeFileSync(
    join(resources, "capacitor.config.json"),
    JSON.stringify({ ...config, packageClassList: [] }, null, 2),
  );
  // The three page scripts both apps inject, kept where Android keeps them.
  const scripts = join(resources, "page-scripts");
  mkdirSync(scripts, { recursive: true });
  for (const name of ["account.js", "media-session.js", "top-color.js"])
    cpSync(
      join(repo, "engine/k7-android/app/src/main/assets", name),
      join(scripts, name),
    );
}

// The frontend the backend serves, then the backend bundled with what it reads, and the desktop's table beside it.
if (wanted("backend")) {
  run("npm", ["exec", "--workspace", "k7-frontend", "--", "vite", "build"]);
  const out = join(resources, "backend");
  rmSync(out, { recursive: true, force: true });
  run("node", ["apps/k7/backend/scripts/bundle.mjs", out]);
  cpSync(
    join(repo, "apps/k7/backend/standalone.json"),
    join(out, "standalone.json"),
  );
}

console.log(
  `[stage] staged for ${sim ? "the simulator" : "a device"} in ${staged}`,
);
