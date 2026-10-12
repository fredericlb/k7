// libraries.ts — the origin's LIBRARIES, held by the hub: the one list (`<dataRoot>/libraries.json`)
// and one FOLDER per library under `<dataRoot>/libraries/<name>`, which every account's file service
// reads and only admins write. A listed library missing on disk is copied from the seed
// (`$STUDIO_LIBRARY_SEED`: a folder of libraries, or `name=folder,…`) or made empty. Its edits reach other replicas through st0fs
// (libraryRelay.ts). See docs/fileHub.md.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { isLibraryName } from "@studio/song-schema/moduleTypes";
import type { AccountLibrariesReply, LibraryNote } from "@studio/web-protocol";

/** One library of the origin: the name its refs use (`@<name>/…`), which is also its folder's. */
export interface LibrarySetting {
  name: string;
}

/** Why `list` cannot be the origin's libraries, or null when it can. */
export function settingsProblem(list: LibrarySetting[]): string | null {
  const names = new Set<string>();
  for (const l of list) {
    if (!isLibraryName(l.name))
      return `'${l.name}' cannot name a library — lowercase letters, digits and dashes, and not engine, workspace or meta`;
    if (names.has(l.name)) return `two libraries are called '${l.name}'`;
    names.add(l.name);
  }
  return null;
}

/** A `libraries.json` read as a list of names; entries written with a `uri` keep their name, anything unreadable is none. */
function parseList(text: string): LibrarySetting[] {
  let raw: { libraries?: unknown };
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw?.libraries)) return [];
  const out: LibrarySetting[] = [];
  for (const l of raw.libraries as { name?: unknown }[])
    if (
      typeof l?.name === "string" &&
      isLibraryName(l.name) &&
      !out.some((o) => o.name === l.name)
    )
      out.push({ name: l.name });
  return out;
}

/** The seed's libraries by name: `name=folder,…`, or every library folder directly under one folder. */
export function parseSeed(value: string | undefined): Map<string, string> {
  const seed = new Map<string, string>();
  const v = value?.trim();
  if (!v) return seed;
  if (!v.includes("=")) {
    for (const name of libraryFolders(resolve(v)))
      seed.set(name, join(resolve(v), name));
    return seed;
  }
  for (const pair of v.split(",")) {
    const [name, dir] = pair.split("=").map((x) => x.trim());
    if (name && dir && isLibraryName(name)) seed.set(name, resolve(dir));
  }
  return seed;
}

/** The library folders directly under `dir`. */
function libraryFolders(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && isLibraryName(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

export class LibraryStore {
  /** Where the libraries are — what every file service gets as `$STUDIO_LIBRARIES_HOME`. */
  readonly home: string;
  private readonly listFile: string;
  private readonly seed: Map<string, string>;

  constructor(
    private readonly dataRoot: string,
    seed: string | undefined = process.env.STUDIO_LIBRARY_SEED,
  ) {
    this.home = join(dataRoot, "libraries");
    this.listFile = join(dataRoot, "libraries.json");
    this.seed = parseSeed(seed);
  }

  /** The list; with none written yet, the libraries already on disk, else the seed's. */
  settings(): LibrarySetting[] {
    if (existsSync(this.listFile))
      return parseList(readFileSync(this.listFile, "utf8"));
    const here = libraryFolders(this.home);
    return (here.length ? here : [...this.seed.keys()]).map((name) => ({
      name,
    }));
  }

  /** Write the list — validated first, and through a sibling and a rename, since every file service reads it. */
  private write(list: LibrarySetting[]): void {
    const problem = settingsProblem(list);
    if (problem) throw new Error(problem);
    mkdirSync(this.dataRoot, { recursive: true });
    const tmp = `${this.listFile}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ libraries: list }, null, 2)}\n`);
    renameSync(tmp, this.listFile);
  }

  /** The list as an account sees it: each library, and whether the server holds its folder. */
  view(notes?: LibraryNote[]): AccountLibrariesReply {
    const reply: AccountLibrariesReply = {
      libraries: this.settings().map((l) => ({
        name: l.name,
        present: existsSync(join(this.home, l.name)),
      })),
    };
    if (notes?.length) reply.notes = notes;
    return reply;
  }

  /** SET the list: each new library gets its folder; one dropped keeps its folder, unlisted. */
  set(
    asked: LibrarySetting[],
  ): { ok: true; reply: AccountLibrariesReply } | { error: string } {
    const problem = settingsProblem(asked);
    if (problem) return { error: problem };
    const notes = asked.map((l) => this.ensureOne(l.name));
    const failed = notes.filter((n) => n.state === "failed");
    if (failed.length)
      return { error: failed.map((n) => `'${n.name}': ${n.note}`).join("; ") };
    this.write(asked);
    return { ok: true, reply: this.view(notes) };
  }

  /** Give every listed library (or only `name`) its folder; answers what was done to each. */
  ensure(opts: { name?: string } = {}): LibraryNote[] {
    return this.settings()
      .filter((l) => !opts.name || l.name === opts.name)
      .map((l) => this.ensureOne(l.name));
  }

  /** Copy into a SIBLING and rename it into place: a dot-name is never a library, so no reader sees half of one. */
  private ensureOne(name: string): LibraryNote {
    const at = join(this.home, name);
    if (existsSync(at)) return { name, state: "current", note: "here" };
    const partial = join(this.home, `.seeding-${Date.now()}-${process.pid}`);
    try {
      mkdirSync(this.home, { recursive: true });
      const from = this.seed.get(name);
      if (from && existsSync(from)) {
        cpSync(from, partial, {
          recursive: true,
          filter: (src) => !src.split(/[\\/]/).includes(".git"),
        });
        renameSync(partial, at);
        return { name, state: "seeded", note: `copied from ${from}` };
      }
      mkdirSync(at);
      return { name, state: "created", note: "empty" };
    } catch (e) {
      rmSync(partial, { recursive: true, force: true });
      return { name, state: "failed", note: (e as Error).message.trim() };
    }
  }
}
