// stage.mjs — lay out src-tauri/resources for `tauri build` (and `tauri dev`): k7's backend bundle with the frontend
// in it, standalone.json, the engine and the supervisor, and the node the bundle runs on, pinned and checksummed.
// The engine comes from the repo's builds, or `$STUDIO_PREBUILT_BIN` in CI (engine/scripts/docs/buildEngine.md).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stageEngine } from "@studio/supervisor-host/stageEngine";

/** The node the backend runs on: Node 24 LTS, as .nvmrc says; bumped by hand, its checksum read from nodejs.org. */
const NODE_VERSION = "24.22.0";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(app, "..", "..");
const out = join(app, "src-tauri", "resources");
const cache = join(repo, "dist", "cache", "node");

const run = (cmd, args, cwd = repo) => {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
};

/** Node's archive for this machine, and the path of the binary inside it. */
function nodeArchive() {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const base = `node-v${NODE_VERSION}`;
  if (process.platform === "win32")
    return { file: `${base}-win-${arch}.zip`, inner: `${base}-win-${arch}/node.exe` };
  const os = process.platform === "darwin" ? "darwin" : "linux";
  return {
    file: `${base}-${os}-${arch}.tar.gz`,
    inner: `${base}-${os}-${arch}/bin/node`,
  };
}

async function download(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** The archive, from the cache or nodejs.org, refused unless its SHA-256 is the one SHASUMS256.txt names. */
async function nodeBinary() {
  const { file, inner } = nodeArchive();
  const dist = `https://nodejs.org/dist/v${NODE_VERSION}`;
  mkdirSync(cache, { recursive: true });
  const sums = (await download(`${dist}/SHASUMS256.txt`)).toString("utf8");
  const want = sums
    .split("\n")
    .find((l) => l.trim().endsWith(`  ${file}`))
    ?.split(/\s+/)[0];
  if (!want) throw new Error(`${file} is not in node's SHASUMS256.txt`);
  const archive = join(cache, file);
  if (!existsSync(archive)) writeFileSync(archive, await download(`${dist}/${file}`));
  const got = createHash("sha256").update(readFileSync(archive)).digest("hex");
  if (got !== want) {
    rmSync(archive, { force: true });
    throw new Error(`${file}: sha256 ${got}, expected ${want}`);
  }
  const unpacked = join(cache, `v${NODE_VERSION}`);
  rmSync(unpacked, { recursive: true, force: true });
  mkdirSync(unpacked, { recursive: true });
  // System32's bsdtar on Windows reads a .zip by itself; a bare `tar` there may be GNU tar, which cannot.
  const tar =
    process.platform === "win32"
      ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
      : "tar";
  run(tar, ["-x", "-f", archive, "-C", unpacked, inner]);
  return join(unpacked, inner);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

console.log("· frontend");
run("npm", ["exec", "--workspace", "k7-frontend", "--", "vite", "build"]);

console.log("· backend");
run("node", [
  join(repo, "apps", "k7", "backend", "scripts", "bundle.mjs"),
  join(out, "backend"),
]);
copyFileSync(
  join(repo, "apps", "k7", "backend", "standalone.json"),
  join(out, "standalone.json"),
);

console.log("· engine and supervisor");
stageEngine({ repo, bin: join(out, "bin") });

console.log(`· node ${NODE_VERSION}`);
mkdirSync(join(out, "node"), { recursive: true });
const node = await nodeBinary();
const name = process.platform === "win32" ? "node.exe" : "node";
copyFileSync(node, join(out, "node", name));
chmodSync(join(out, "node", name), 0o755);

console.log(`staged in ${out}`);
