// libraryArchive.mjs — the `st0` library a desktop or phone bundle carries: the newest version the
// origin PUBLISHED that this build runs, manifest included, so the hub installs it under its own
// number (packages/file-hub/libraries.ts). Unreachable origin: the repo's folder, which installs as
// version 1, said loudly. See ../../../../docs/library-versions-plan.md.

import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const PUBLIC = "/api/public/libraries";

/** This build's LIBRARY_LEVEL, read off the source that declares it. */
function buildLevel(repo) {
  const src = readFileSync(
    join(repo, "packages/song-schema/src/libraryVersions.ts"),
    "utf8",
  );
  const m = /export const LIBRARY_LEVEL = (\d+);/.exec(src);
  if (!m) throw new Error("LIBRARY_LEVEL not found in libraryVersions.ts");
  return Number(m[1]);
}

/** Download the newest runnable published `st0` into `dest`; answers its version, or throws. */
async function fromOrigin(origin, level, dest) {
  const r = await fetch(`${origin}${PUBLIC}`);
  if (!r.ok) throw new Error(`${origin} answered ${r.status}`);
  const st0 = (await r.json()).libraries.find((l) => l.name === "st0");
  const runnable = (st0?.versions ?? []).filter((v) => v.requires <= level);
  if (!runnable.length)
    throw new Error(`${origin} publishes no st0 for level ${level}`);
  const version = Math.max(...runnable.map((v) => v.version));
  const base = `${origin}${PUBLIC}/st0/${version}`;
  const listing = await fetch(base);
  if (!listing.ok) throw new Error(`${base} answered ${listing.status}`);
  for (const f of (await listing.json()).files) {
    if (f.path.split("/").some((s) => !s || s === "." || s === ".."))
      throw new Error(`refusing the path ${f.path}`);
    const got = await fetch(`${base}/file?path=${encodeURIComponent(f.path)}`);
    if (!got.ok) throw new Error(`${f.path}: ${got.status}`);
    const bytes = Buffer.from(await got.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== f.sha256)
      throw new Error(`${f.path} arrived damaged`);
    const at = join(dest, ...f.path.split("/"));
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, bytes);
  }
  return version;
}

/** Lay the bundle's `st0` library out at `dest`: published when the origin answers, else the repo's. */
export async function bundleLibrary(repo, dest) {
  const origin = (
    process.env.STUDIO_LIBRARY_ORIGIN ?? "https://st0.app"
  ).replace(/\/+$/, "");
  rmSync(dest, { recursive: true, force: true });
  try {
    const version = await fromOrigin(origin, buildLevel(repo), dest);
    console.log(`library: st0 ${version}, published by ${origin}`);
    return;
  } catch (e) {
    rmSync(dest, { recursive: true, force: true });
    console.warn(
      `\n!! library: ${e.message}\n!! bundling the repo's st0-library instead, which a new install reads as version 1\n`,
    );
  }
  cpSync(join(repo, "st0-library"), dest, {
    recursive: true,
    filter: (src) => basename(src) !== ".git",
  });
}
