// buildAddon.mjs — builds rust/node for THIS machine's node, as rust/target/release/k7x.node, to test the addon the iOS app runs.
// A reader would get wrong that a host needs it: every host with WebAssembly reads through that instead; iOS's build is engine/k7-ios/scripts/stage.mjs.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const RUST = join(import.meta.dirname, "..", "rust");
const env = { ...process.env };
if (process.platform === "win32" && !env.K7X_NODE_LIB) {
  // node-gyp's cache holds node.lib for the running node once any addon was built here.
  const dir = join(
    env.LOCALAPPDATA ?? "",
    "node-gyp",
    "Cache",
    process.versions.node,
    process.arch,
  );
  if (!existsSync(join(dir, "node.lib")))
    throw new Error(
      `no node.lib in ${dir}: run \`npx node-gyp install\`, or set K7X_NODE_LIB`,
    );
  env.K7X_NODE_LIB = dir;
}
execFileSync("cargo", ["build", "--release", "-p", "k7x-node"], {
  cwd: RUST,
  stdio: "inherit",
  env,
});
const lib =
  { win32: "k7x_node.dll", darwin: "libk7x_node.dylib" }[process.platform] ??
  "libk7x_node.so";
const out = join(RUST, "target", "release", "k7x.node");
copyFileSync(join(RUST, "target", "release", lib), out);
console.log(`K7X_ADDON=${out}`);
