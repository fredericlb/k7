// with-env.mjs — runs a local tool with env vars set, cross-platform: `VAR=1 tool …` in an npm
// script is POSIX shell syntax, and npm on Windows hands scripts to cmd.exe, which reads the
// assignment as the command name and fails before the tool starts.
// Usage: node scripts/with-env.mjs NAME=value … <tool> [args…]
// The tool is spawned as node + its package's bin entry, so no shell is involved at all.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const env = { ...process.env };

while (argv.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0])) {
  const [name, ...value] = argv.shift().split("=");
  env[name] = value.join("=");
}

const [tool, ...args] = argv;
if (!tool) throw new Error("with-env.mjs: no command given");

// Resolve the package's declared bin rather than node_modules/.bin, whose Windows shim needs cmd.
const manifest = require.resolve(`${tool}/package.json`);
const { bin } = require(manifest);
const entry = typeof bin === "string" ? bin : bin?.[tool];
if (!entry) throw new Error(`with-env.mjs: ${tool} declares no bin`);

const child = spawn(
  process.execPath,
  [path.resolve(path.dirname(manifest), entry), ...args],
  {
    stdio: "inherit",
    env,
  },
);
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
