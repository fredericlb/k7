// termux-debs.mjs — the pinned Termux .debs: the pin table, where each may be fetched, and the digest that decides.
// The project's own mirror is asked first, since Termux's pool drops a version as soon as a newer one lands.
// A source is only a place to look: bytes are kept when their SHA-256 is the pin's, wherever they came from.
// See engine/k7-runtime/docs/android.md.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PINS = join(
  dirname(fileURLToPath(import.meta.url)),
  "termux-packages.json",
);

// The prerelease whose assets are the pinned debs, filled by mirror-termux-debs.mjs.
export const MIRROR_REPO = "fredericlb/k7";
export const MIRROR_TAG = "termux-debs";

// Termux's own pool under its two hostnames, the first also the index `--pin` reads.
export const POOLS = [
  "https://packages-cf.termux.dev/apt/termux-main",
  "https://packages.termux.dev/apt/termux-main",
];

// The program and every package its libraries come from (Termux's nodejs Depends, plus the CA bundle).
export const PACKAGES = [
  "nodejs",
  "libc++",
  "openssl",
  "c-ares",
  "libicu",
  "libsqlite",
  "zlib",
  "libffi",
  "ca-certificates",
];

/** A pool path's file name as a release asset: GitHub rewrites `:` and `+`, so anything outside a safe set becomes `_`. */
export const assetName = (file) =>
  basename(file).replace(/[^A-Za-z0-9._-]/g, "_");

/** Every URL a pinned deb may come from, in the order they are tried. */
export const sources = (file) => [
  `https://github.com/${MIRROR_REPO}/releases/download/${MIRROR_TAG}/${assetName(file)}`,
  ...POOLS.map((pool) => `${pool}/${file}`),
];

/** The pin table, every package checked for a pool path and a digest. */
export function readPins() {
  const pinned = JSON.parse(readFileSync(PINS, "utf8"));
  for (const name of PACKAGES) {
    const entry = pinned[name];
    if (!entry?.file || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? ""))
      throw new Error(`${PINS}: no valid pin for '${name}'`);
  }
  return pinned;
}

const digest = (data) => createHash("sha256").update(data).digest("hex");

/** A pinned .deb in `cache`, taken from the first source whose bytes match the pin, and checked again when cached. */
export async function fetchDeb(cache, { file, sha256 }) {
  const at = join(cache, assetName(file));
  if (existsSync(at)) {
    if (digest(readFileSync(at)) === sha256) return at;
    rmSync(at);
  }
  const misses = [];
  for (const url of sources(file)) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      misses.push(`${url}: ${e.cause?.code ?? e.message}`);
      continue;
    }
    if (!res.ok) {
      misses.push(`${url}: HTTP ${res.status}`);
      continue;
    }
    const data = Buffer.from(await res.arrayBuffer());
    const got = digest(data);
    if (got !== sha256) {
      misses.push(`${url}: sha256 ${got}`);
      continue;
    }
    writeFileSync(at, data);
    return at;
  }
  throw new Error(
    `${file} (sha256 ${sha256}) is at none of its sources; mirror it (mirror-termux-debs.mjs) or re-pin (termux-tools.mjs --pin):\n  ${misses.join("\n  ")}`,
  );
}
