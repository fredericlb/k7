// abletonZip.ts — an Ableton project ZIPPED: the folder "Collect All and Save" leaves, sent as one
// file. The set and its samples travel together, so unlike a lone `.als` it can be dropped. This
// unzips in memory, picks the set, and resolves each sample inside the archive; `parseAls` does
// the rest. The one thing a reader would get wrong: Live keeps old saves under `Backup/`, each a
// `.als` too, and those are never the project. See docs/import.md.

import { parseAls, type SampleRef } from "./ableton";
import { boundedUnzip } from "./inflate";
import type { Translation } from "./model";

/** Entries no project is made of: Live's own backups, and the resource forks a Mac zip carries. */
const noise = (path: string): boolean =>
  /(^|\/)(Backup|__MACOSX)\//i.test(path) || /(^|\/)\._/.test(path);

const dirOf = (path: string): string =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

/** `a/b/../c` → `a/c`: a sample path is relative to the set, and may climb out of its folder. */
function normalise(path: string): string {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/** The set a zip holds: the one `.als` outside `Backup/`, the shallowest when a folder nests another. */
export function pickSet(paths: readonly string[]): string {
  const sets = paths.filter(
    (p) => p.toLowerCase().endsWith(".als") && !noise(p),
  );
  if (!sets.length)
    throw new Error(
      "this zip holds no Ableton set (.als) — zip the project folder Live's Collect All and Save leaves",
    );
  const depth = (p: string) => p.split("/").length;
  const top = Math.min(...sets.map(depth));
  const shallow = sets.filter((p) => depth(p) === top);
  if (shallow.length > 1)
    throw new Error(
      `this zip holds ${shallow.length} Ableton sets (${shallow.join(", ")}) — zip one project at a time`,
    );
  return shallow[0];
}

/** Translate a zipped Ableton project; `fallbackName` names the song when the set states none. */
export function parseAlsZip(
  bytes: Uint8Array,
  fallbackName: string,
): Translation & { set: string } {
  // A zip starts PK\x03\x04 — said plainly rather than left to fflate's "invalid zip data".
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    throw new Error("this is not a zip file");
  const entries = boundedUnzip(bytes);
  const set = pickSet(Object.keys(entries));
  const base = dirOf(set);
  const byName = new Map<string, string[]>();
  for (const p of Object.keys(entries)) {
    if (noise(p) || p.endsWith("/")) continue;
    const name = p.slice(p.lastIndexOf("/") + 1).toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), p]);
  }
  // Where the set says, relative to itself; else the one file of that name — an absolute path names another machine.
  const readSample = (ref: SampleRef): Uint8Array | null => {
    if (ref.relative) {
      const at = normalise(base ? `${base}/${ref.relative}` : ref.relative);
      if (entries[at]) return entries[at];
    }
    const named = byName.get(ref.name.toLowerCase()) ?? [];
    return named.length === 1 ? entries[named[0]] : null;
  };
  const stem = set.slice(set.lastIndexOf("/") + 1).replace(/\.als$/i, "");
  return {
    ...parseAls(entries[set], stem || fallbackName, { readSample }),
    set,
  };
}
