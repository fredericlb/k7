// termux-tools.mjs — node for the phone's backend: Termux's arm64 builds, laid out as
// lib*.so files, since the native library directory is the only place Android lets an app execute a file.
// Names and the Termux prefix are patched IN PLACE, same length, so no binary is relinked.
// Every .deb is the one pinned in termux-packages.json, checked by its SHA-256 (termux-debs.mjs): no index is trusted at build time.
// Usage: ANDROID_NDK_HOME=… node termux-tools.mjs <jniOut> <assetOut> <cacheDir>; `--pin` rewrites the table from the index.
// See engine/k7-runtime/docs/android.md.

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fetchDeb, PACKAGES, PINS, POOLS, readPins } from "./termux-debs.mjs";

const PREFIX = "data/data/com.termux/files/usr";
const TERMUX_SH = "/data/data/com.termux/files/usr/bin/sh";

// Each program and the library name it ships as.
const PROGRAMS = {
  "bin/node": "libk7node.so",
};

/** The index's stanza for each package: where it is and its digest, read only to write a new pin table. */
async function index() {
  const text = await (
    await fetch(`${POOLS[0]}/dists/stable/main/binary-aarch64/Packages`)
  ).text();
  const out = new Map();
  for (const stanza of text.split("\n\n")) {
    const field = (k) => stanza.match(new RegExp(`^${k}: (.*)$`, "m"))?.[1];
    const name = field("Package");
    if (name)
      out.set(name, {
        version: field("Version"),
        file: field("Filename"),
        sha256: field("SHA256"),
      });
  }
  return out;
}

/** A .deb's data.tar.* member, read here: macOS's `ar` refuses the GNU member names a .deb carries. */
function dataMember(debFile) {
  const buf = readFileSync(debFile);
  // "!<arch>\n", then per member a 60-byte header (name 16, size at 48..58) and its data, padded to even.
  for (let at = 8; at + 60 <= buf.length; ) {
    const name = buf
      .toString("latin1", at, at + 16)
      .trim()
      .replace(/\/$/, "");
    const size = Number(buf.toString("latin1", at + 48, at + 58).trim());
    if (name.startsWith("data.tar"))
      return { name, data: buf.subarray(at + 60, at + 60 + size) };
    at += 60 + size + (size % 2);
  }
  throw new Error(`${debFile}: no data.tar member`);
}

/** A .deb's files under `root`. */
function extract(debFile, root) {
  const { name, data } = dataMember(debFile);
  const tarball = join(cache, name);
  writeFileSync(tarball, data);
  if (process.platform === "win32") extractWithoutLinks(tarball, root);
  else execFileSync("tar", ["xf", tarball, "-C", root]);
  rmSync(tarball);
}

/** Windows' tar cannot create a symlink: they are left out, then each is a COPY of what it points at. */
function extractWithoutLinks(tarball, root) {
  const links = execFileSync("tar", ["tvf", tarball])
    .toString()
    .split(/\r?\n/)
    .filter((l) => l.startsWith("l"))
    .map((l) => / (\.\/.*) -> (.*)$/.exec(l))
    .filter(Boolean)
    .map(([, path, to]) => ({ path, to }));
  const skip = links.flatMap((l) => ["--exclude", l.path]);
  execFileSync("tar", ["xf", tarball, "-C", root, ...skip]);
  // Twice, so a link to a link is copied once its target is.
  for (let pass = 0; pass < 2; pass++)
    for (const l of links) {
      const at = join(root, l.path);
      const from = l.to.startsWith("/")
        ? join(root, l.to)
        : resolve(dirname(at), l.to);
      if (existsSync(from) && !existsSync(at))
        cpSync(from, at, { recursive: true });
    }
}

const readelf = () => {
  const prebuilt = join(ndk, "toolchains", "llvm", "prebuilt");
  return join(prebuilt, readdirSync(prebuilt)[0], "bin", "llvm-readelf");
};

/** The shared libraries `file` loads, as named in its dynamic section. */
const needed = (tool, file) =>
  [
    ...execFileSync(tool, ["-d", file])
      .toString()
      .matchAll(/\(NEEDED\).*\[(.*)\]/g),
  ].map((m) => m[1]);

/** Every library the programs load, transitively, among those Termux ships. */
function closure(usr) {
  const tool = readelf();
  const seen = new Set();
  const todo = Object.keys(PROGRAMS).map((p) => join(usr, p));
  while (todo.length) {
    for (const lib of needed(tool, todo.pop())) {
      if (seen.has(lib) || !existsSync(join(usr, "lib", lib))) continue;
      seen.add(lib);
      todo.push(join(usr, "lib", lib));
    }
  }
  return [...seen];
}

/** `libcrypto.so.3` → `libcrypto3.so`: only lib*.so reaches the native library directory; never longer than the original. */
function libName(name) {
  // The engine may ship the NDK's own libc++_shared.so, so Termux's is kept apart.
  if (name === "libc++_shared.so") return "libtcxx.so";
  const [base, version] = name.split(".so");
  return version ? `${base}${version.replaceAll(".", "")}.so` : name;
}

/** `old` swapped for `next` everywhere in `data`, padded to the same length so no offset moves. */
function replace(data, old, next, pad) {
  if (next.length > old.length)
    throw new Error(`${next} is longer than ${old}`);
  const to = Buffer.concat([next, Buffer.alloc(old.length - next.length, pad)]);
  for (
    let i = data.indexOf(old);
    i !== -1;
    i = data.indexOf(old, i + old.length)
  )
    to.copy(data, i);
}

function patch(data, renames) {
  for (const [from, to] of renames)
    if (from !== to)
      replace(data, Buffer.from(`${from}\0`), Buffer.from(`${to}\0`), 0);
  replace(
    data,
    Buffer.from(`${TERMUX_SH}\0`),
    Buffer.from("/system/bin/sh\0"),
    0,
  );
  // Inside node's own JS the path is a string literal: padded with spaces, so the source stays valid.
  replace(
    data,
    Buffer.from(`'${TERMUX_SH}'`),
    Buffer.from("'/system/bin/sh'"),
    0x20,
  );
  return data;
}

// `--pin`: the current index's entry for every package, written for review and commit, then nothing else.
if (process.argv[2] === "--pin") {
  const known = await index();
  const pins = {};
  for (const name of PACKAGES) {
    const entry = known.get(name);
    if (!entry?.file || !entry.sha256)
      throw new Error(`Termux has no package '${name}'`);
    pins[name] = entry;
  }
  writeFileSync(PINS, `${JSON.stringify(pins, null, 2)}\n`);
  console.log(`termux tools: ${PACKAGES.length} packages pinned in ${PINS}`);
  process.exit(0);
}

const [jniOut, assetOut, cache] = process.argv.slice(2);
if (!jniOut || !assetOut || !cache)
  throw new Error("usage: termux-tools.mjs <jniOut> <assetOut> <cacheDir>");
const ndk = process.env.ANDROID_NDK_HOME;
if (!ndk) throw new Error("ANDROID_NDK_HOME is not set");

const pinned = readPins();
mkdirSync(cache, { recursive: true });
const root = join(cache, "root");
rmSync(root, { recursive: true, force: true });
mkdirSync(root);
const versions = {};
for (const name of PACKAGES) {
  versions[name] = pinned[name].version;
  extract(await fetchDeb(cache, pinned[name]), root);
}

const usr = join(root, PREFIX);
const renames = new Map(closure(usr).map((l) => [l, libName(l)]));
rmSync(jniOut, { recursive: true, force: true });
mkdirSync(jniOut, { recursive: true });
const files = [
  ...Object.entries(PROGRAMS),
  ...[...renames].map(([from, to]) => [`lib/${from}`, to]),
];
for (const [from, to] of files) {
  const at = join(jniOut, to);
  writeFileSync(at, patch(readFileSync(join(usr, from)), renames));
  chmodSync(at, 0o755);
}

// The CA bundle node trusts: Termux's, since Android's store is a folder of files it does not read.
mkdirSync(assetOut, { recursive: true });
copyFileSync(join(usr, "etc", "tls", "cert.pem"), join(assetOut, "cacert.pem"));
writeFileSync(
  join(assetOut, "termux-versions.json"),
  `${JSON.stringify(versions, null, 2)}\n`,
);
console.log(
  `termux tools: ${files.length} files in ${jniOut} (node ${versions.nodejs})`,
);
