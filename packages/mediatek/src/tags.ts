// tags.ts — a song's title, artist, album, tempo and key, read from and written into its
// master's own tags (ID3, Vorbis comments, MP4 atoms…) through TagLib — see docs/songs.md.
// A write never edits the master in place: it tags a copy beside it and swaps it in, because
// the engine may be playing the file. Node-only.

import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { TagLib } from "taglib-wasm";
import { isAudio, withoutDerived } from "./media.ts";
import { placeFile } from "./place.ts";
import { KEY_PATTERN, type MasterTags, type OtherTags } from "./types.ts";

/** A master TagLib cannot open — not audio it knows, or damaged; a 422 over HTTP. */
export class UntaggableError extends Error {}

// The wire names TagLib maps onto each format's own frame (TIT2, TBPM, TKEY in ID3…).
const WIRE = {
  title: "TITLE",
  artist: "ARTIST",
  album: "ALBUM",
  bpm: "BPM",
  key: "INITIALKEY",
} as const satisfies Record<keyof MasterTags, string>;

/** The binary's repo path — what bundle.mjs stages beside a standalone backend, at that same path. */
export const TAGLIB_WASM = "node_modules/taglib-wasm/dist/taglib-web.wasm";

/** The binary, looked for up from this file: in a bundle the package's own lookup would search beside the bundle. */
function wasmBytes(): Uint8Array {
  for (let dir = import.meta.dirname; ; dir = dirname(dir)) {
    const at = join(dir, TAGLIB_WASM);
    if (existsSync(at)) return readFileSync(at);
    if (dirname(dir) === dir)
      throw new UntaggableError(`${TAGLIB_WASM} not found`);
  }
}

let lib: Promise<TagLib> | null = null;
const taglib = (): Promise<TagLib> => {
  lib ??= TagLib.initialize({
    wasmBinary: wasmBytes(),
    forceWasmType: "emscripten",
  }).catch((e) => {
    lib = null; // a failed start is retried by the next caller, not remembered
    throw e;
  });
  return lib;
};

// `bpm: 128` and `"128.5"` are both meant; NaN and 0 — the engine's "none found" — are not.
const positive = (v: string | undefined): number | undefined => {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? n : undefined;
};

/** The five fields out of whatever the file carries; a field absent or blank is left out. */
async function readFresh(abs: string): Promise<MasterTags> {
  const file = await (await taglib()).open(abs);
  try {
    const one = (k: string): string | undefined =>
      file.getProperty(k)?.[0]?.trim() || undefined;
    const key = one(WIRE.key);
    const bpm = positive(one(WIRE.bpm));
    return {
      ...(one(WIRE.title) ? { title: one(WIRE.title) } : {}),
      ...(one(WIRE.artist) ? { artist: one(WIRE.artist) } : {}),
      ...(one(WIRE.album) ? { album: one(WIRE.album) } : {}),
      ...(bpm ? { bpm } : {}),
      // Another tool's spelling (`8A`, `Abm`) is not ours to guess at: it reads as no key.
      ...(key && KEY_PATTERN.test(key) ? { key } : {}),
    };
  } finally {
    file.dispose();
  }
}

// The scan reads every master on every listing: a file whose size and mtime have not moved is not reopened.
const memo = new Map<string, { at: string; tags: MasterTags }>();
const MEMO_MAX = 50_000;

/** A master's tags, or `{}` for a file TagLib cannot open — a listing is never refused over one file. */
export async function readMasterTags(abs: string): Promise<MasterTags> {
  let at: string;
  try {
    const st = await stat(abs);
    at = `${st.size}:${st.mtimeMs}`;
  } catch {
    return {};
  }
  const hit = memo.get(abs);
  if (hit?.at === at) return hit.tags;
  let tags: MasterTags;
  try {
    tags = await readFresh(abs);
  } catch {
    tags = {};
  }
  if (memo.size >= MEMO_MAX) memo.clear();
  memo.set(abs, { at, tags });
  return tags;
}

/** The text a field is written as; `""` removes the frame. */
function wire(
  field: keyof MasterTags,
  v: MasterTags[keyof MasterTags],
): string {
  if (v === undefined || v === "") return "";
  if (field === "bpm") {
    const n = Number(v);
    // Two decimals: a detected 127.98 is a grid, and ID3's integer convention would move it.
    return Number.isFinite(n) && n > 0 ? String(Math.round(n * 100) / 100) : "";
  }
  return String(v).trim();
}

/** Write the fields `patch` names into the master — `undefined` or `""` clears one, a field absent is untouched. */
export async function writeMasterTags(
  abs: string,
  patch: Partial<Record<keyof MasterTags, string | number | undefined>>,
): Promise<MasterTags> {
  const fields = (Object.keys(WIRE) as (keyof MasterTags)[]).filter((f) =>
    Object.hasOwn(patch, f),
  );
  if (fields.length === 0) return readMasterTags(abs);
  // Beside the master, so the swap is a rename on one device; a random suffix, so two writers never share it.
  const tmp = `${abs}.${randomUUID()}.part`;
  try {
    copyFileSync(abs, tmp);
    try {
      await (await taglib()).edit(tmp, (file) => {
        for (const f of fields) {
          const text = wire(f, patch[f]);
          if (text) file.setProperty(WIRE[f], text);
          else file.removeProperty(WIRE[f]);
        }
      });
    } catch (e) {
      throw new UntaggableError(
        `${abs}: ${(e as Error).message || "tags cannot be written"}`,
      );
    }
    await placeFile(tmp, abs);
  } finally {
    rmSync(tmp, { force: true });
  }
  memo.delete(abs);
  return readMasterTags(abs);
}

// TagLib names a field it knows in camelCase (`title`) and leaves the rest raw (`INITIALKEY`).
const OURS = new Set(Object.values(WIRE).map((w) => w.toLowerCase()));

/** Every OTHER tag the master carries, as TagLib names it — shown, never written here; `{}` for a file it cannot open. */
export async function readOtherTags(abs: string): Promise<OtherTags> {
  let file: Awaited<ReturnType<TagLib["open"]>>;
  try {
    file = await (await taglib()).open(abs);
  } catch {
    return {};
  }
  try {
    const out: OtherTags = {};
    for (const [k, values] of Object.entries(file.properties())) {
      const kept = (values ?? []).map(String).filter((v) => v.trim());
      if (!OURS.has(k.toLowerCase()) && kept.length) out[k] = kept;
    }
    return out;
  } finally {
    file.dispose();
  }
}

/** A song folder's master NAME, its tags and the file's other tags, the folder given on disk — `null` for one holding no audio. */
export async function songTags(
  abs: string,
): Promise<{ master: string; tags: MasterTags; others: OtherTags } | null> {
  let names: { name: string }[];
  try {
    names = (await readdir(abs)).map((name) => ({ name }));
  } catch {
    return null;
  }
  const name = withoutDerived(names).find((e) => isAudio(e.name))?.name;
  if (!name) return null;
  const at = join(abs, name);
  return {
    master: name,
    tags: await readMasterTags(at),
    others: await readOtherTags(at),
  };
}
