// libraryArchive.mjs — the `k7-core` library a desktop or phone bundle carries: the newest version this
// build runs, manifest included, so the hub installs it under its own number (packages/file-hub/libraries.ts).
// The origin's published one, unless the repo's `k7-core/library.k7x` declares a higher number; the
// repo's too when the origin cannot answer, said loudly. See ../../../../docs/library-versions-plan.md.

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

/** The version the repo's `k7-core/library.k7x` declares, or 0 when it declares none this build runs. */
function repoVersion(repo, level) {
  let text;
  try {
    text = readFileSync(join(repo, "k7-core", "library.k7x"), "utf8");
  } catch {
    return 0;
  }
  const version = Number(/^version\((\d+)\)/m.exec(text)?.[1] ?? 0);
  const requires = Number(/^requires\((\d+)\)/m.exec(text)?.[1] ?? 1);
  return requires <= level ? version : 0;
}

/** The newest `k7-core` the origin publishes that a build at `level` runs; throws when there is none. */
async function originNewest(origin, level) {
  const r = await fetch(`${origin}${PUBLIC}`);
  if (!r.ok) throw new Error(`${origin} answered ${r.status}`);
  const k7 = (await r.json()).libraries.find((l) => l.name === "k7-core");
  const runnable = (k7?.versions ?? []).filter((v) => v.requires <= level);
  if (!runnable.length)
    throw new Error(`${origin} publishes no k7-core for level ${level}`);
  return Math.max(...runnable.map((v) => v.version));
}

/** Download version `version` of the origin's `k7-core` into `dest`, or throw. */
async function fromOrigin(origin, version, dest) {
  const base = `${origin}${PUBLIC}/k7-core/${version}`;
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
}

/** Lay the bundle's `k7-core` library out at `dest`: the origin's newest, else the repo's when newer or the origin is out of reach. */
export async function bundleLibrary(repo, dest) {
  const origin = (
    process.env.STUDIO_LIBRARY_ORIGIN ?? "https://app.k7.rocks"
  ).replace(/\/+$/, "");
  const level = buildLevel(repo);
  const ours = repoVersion(repo, level);
  rmSync(dest, { recursive: true, force: true });
  try {
    const version = await originNewest(origin, level);
    // A tie is the origin's: the number it publishes is what an upgrade from it will mean.
    if (version >= ours) {
      await fromOrigin(origin, version, dest);
      console.log(`library: k7-core ${version}, published by ${origin}`);
      return;
    }
    console.log(
      `library: k7-core ${ours} from the repo, newer than ${origin}'s ${version}`,
    );
  } catch (e) {
    rmSync(dest, { recursive: true, force: true });
    console.warn(
      `\n!! library: ${e.message}\n!! bundling the repo's k7-core instead, which a new install reads as version ${ours || 1}\n`,
    );
  }
  cpSync(join(repo, "k7-core"), dest, {
    recursive: true,
    filter: (src) => basename(src) !== ".git",
  });
}
