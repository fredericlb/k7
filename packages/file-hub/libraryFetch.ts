// libraryFetch.ts — bring one published version of a library down from the origin's public listing
// (publicLibraries.ts) onto this machine, for a desktop or a phone that is not paired; only a machine
// that names `$STUDIO_LIBRARY_ORIGIN` asks, never a hosted origin. Each file is
// taken from a version already here when its digest matches, else downloaded, checked, and written
// into a dot-named sibling renamed into place: no reader ever sees half a version.

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  type LibraryManifest,
  versionOfDir,
} from "@studio/song-schema/libraryVersions";
import { type VersionFile, versionFiles } from "./publicLibraries.ts";

/** Where this machine asks for versions: `$STUDIO_LIBRARY_ORIGIN`, which a hosted origin never sets — it IS one. */
export const libraryOrigin = (): string | null =>
  process.env.STUDIO_LIBRARY_ORIGIN?.replace(/\/+$/, "") || null;

/** The public prefix the origin answers on — apps/st0/backend/src/media/fileHub.ts mounts it. */
export const PUBLIC_LIBRARIES_PATH = "/api/public/libraries";

/** How long the origin's listing is trusted: an upgrade waits at most this for a new version to show. */
const LISTING_TTL_MS = 10 * 60_000;
let listing: { at: number; libraries: PublicListing } | null = null;
type PublicListing = { name: string; versions: LibraryManifest[] }[];

/** The versions the origin publishes of `name`; none when this machine names no origin or cannot reach it. */
export async function remoteVersions(
  name: string,
  origin = libraryOrigin(),
): Promise<LibraryManifest[]> {
  if (!origin) return [];
  if (!listing || Date.now() - listing.at > LISTING_TTL_MS) {
    try {
      const r = await fetch(`${origin}${PUBLIC_LIBRARIES_PATH}`);
      if (!r.ok) return [];
      const body = (await r.json()) as { libraries: PublicListing };
      listing = { at: Date.now(), libraries: body.libraries };
    } catch {
      return []; // offline is the ordinary state of a gig: what is here is what there is
    }
  }
  return listing.libraries.find((l) => l.name === name)?.versions ?? [];
}

/** Fetch version `version` of `name` into `home/name/version`; answers null, or why it could not. */
export async function fetchLibraryVersion(
  home: string,
  name: string,
  version: number,
  origin = libraryOrigin(),
): Promise<string | null> {
  const at = join(home, name, String(version));
  if (existsSync(at)) return null;
  if (!origin) return "this machine names no origin to fetch libraries from";
  const base = `${origin}${PUBLIC_LIBRARIES_PATH}/${encodeURIComponent(name)}/${version}`;
  let files: VersionFile[];
  try {
    const r = await fetch(base);
    if (!r.ok) return `the origin has no ${name} ${version} (${r.status})`;
    files = ((await r.json()) as { files: VersionFile[] }).files;
  } catch (e) {
    return `the origin cannot be reached: ${(e as Error).message}`;
  }
  // What this machine already holds, by digest: most files do not change between two versions.
  const held = new Map<string, string>();
  for (const local of localVersions(home, name))
    for (const f of versionFiles(local))
      held.set(f.sha256, join(local, ...f.path.split("/")));
  const partial = join(home, `.fetching-${Date.now()}-${process.pid}`);
  try {
    for (const f of files) {
      const dest = join(partial, ...f.path.split("/"));
      if (f.path.split("/").some((s) => !s || s === "." || s === ".."))
        throw new Error(`refusing the path ${f.path}`);
      mkdirSync(dirname(dest), { recursive: true });
      const same = held.get(f.sha256);
      if (same) {
        copyFileSync(same, dest);
        continue;
      }
      const r = await fetch(`${base}/file?path=${encodeURIComponent(f.path)}`);
      if (!r.ok) throw new Error(`${f.path}: ${r.status}`);
      const bytes = Buffer.from(await r.arrayBuffer());
      if (createHash("sha256").update(bytes).digest("hex") !== f.sha256)
        throw new Error(`${f.path} arrived damaged`);
      writeFileSync(dest, bytes);
    }
    mkdirSync(join(home, name), { recursive: true });
    renameSync(partial, at);
    return null;
  } catch (e) {
    rmSync(partial, { recursive: true, force: true });
    return (e as Error).message;
  }
}

/** The published version folders of `name` here. */
function localVersions(home: string, name: string): string[] {
  try {
    return readdirSync(join(home, name), { withFileTypes: true })
      .filter(
        (d) => d.isDirectory() && typeof versionOfDir(d.name) === "number",
      )
      .map((d) => join(home, name, d.name));
  } catch {
    return []; // no folder yet: nothing to reuse
  }
}
