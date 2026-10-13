// libraries.ts — the origin's LIBRARIES, held by the hub: the one list (`<dataRoot>/libraries.json`)
// and one FOLDER per library under `<dataRoot>/libraries/<name>`: its frozen versions `1/`, `2/`…
// and the `draft/` only admins write. A listed library missing on disk is copied from the seed
// (`$STUDIO_LIBRARY_SEED`: a folder of libraries, or `name=folder,…`) as its version 1, or made empty.
// Its edits reach other replicas through st0fs (libraryRelay.ts). See docs/fileHub.md and
// ../../docs/library-versions-plan.md.

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
import { RECYCLE_DIR } from "@studio/file-service/src/workspaceFilter.ts";
import {
  DRAFT_VERSION,
  LIBRARY_LEVEL,
  LIBRARY_MANIFEST,
  type LibraryManifest,
  parseLibraryManifest,
  stringifyLibraryManifest,
  UNPINNED_VERSION,
  versionOfDir,
} from "@studio/song-schema/libraryVersions";
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
        versions: this.versions(l.name).map(({ version, requires, notes }) =>
          notes ? { version, requires, notes } : { version, requires },
        ),
        draft: existsSync(join(this.home, l.name, DRAFT_VERSION)),
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

  /** Give every listed library (or only `name`) its folder, and its draft when asked; answers what was done to each. */
  ensure(opts: { name?: string; draft?: boolean } = {}): LibraryNote[] {
    return this.settings()
      .filter((l) => !opts.name || l.name === opts.name)
      .map((l) => {
        const note = this.ensureOne(l.name);
        if (!opts.draft || note.state === "failed") return note;
        const drafted = this.ensureDraft(l.name);
        return drafted ?? note;
      });
  }

  /** The published versions of library `name`, oldest first, each as its `library.yaml` says. */
  versions(name: string): LibraryManifest[] {
    return versionNumbers(join(this.home, name)).map(
      (v) =>
        readManifest(join(this.home, name, String(v))) ?? {
          name,
          version: v,
          requires: 1,
        },
    );
  }

  /** Freeze library `name`'s draft as its next version; a version is never written again — docs/library-versions-plan.md. */
  publish(
    name: string,
    opts: { requires?: number; notes?: string } = {},
  ): { ok: true; manifest: LibraryManifest } | { error: string } {
    if (!isLibraryName(name)) return { error: `'${name}' names no library` };
    const at = join(this.home, name);
    const draft = join(at, DRAFT_VERSION);
    if (!existsSync(draft))
      return { error: `'${name}' has no draft to publish` };
    // Unsaid, the previous version's: publishing must not raise the floor by accident and lock old desktops out.
    const requires = opts.requires ?? this.versions(name).at(-1)?.requires ?? 1;
    if (!Number.isInteger(requires) || requires < 1 || requires > LIBRARY_LEVEL)
      return {
        error: `'${name}' cannot require level ${requires}: this st0 runs level ${LIBRARY_LEVEL}`,
      };
    const version = Math.max(0, ...versionNumbers(at)) + 1;
    const manifest: LibraryManifest = { name, version, requires };
    if (opts.notes?.trim()) manifest.notes = opts.notes.trim();
    const partial = join(this.home, `.publishing-${Date.now()}-${process.pid}`);
    try {
      cpSync(draft, partial, { recursive: true, filter: publishable });
      writeFileSync(
        join(partial, LIBRARY_MANIFEST),
        stringifyLibraryManifest(manifest),
      );
      renameSync(partial, join(at, String(version)));
      return { ok: true, manifest };
    } catch (e) {
      rmSync(partial, { recursive: true, force: true });
      return { error: (e as Error).message.trim() };
    }
  }

  /** Copy into a SIBLING and rename it into place: a dot-name is never a library, so no reader sees half of one. */
  private ensureOne(name: string): LibraryNote {
    const at = join(this.home, name);
    if (existsSync(at)) return this.migrate(name);
    const partial = join(this.home, `.seeding-${Date.now()}-${process.pid}`);
    try {
      mkdirSync(this.home, { recursive: true });
      const from = this.seed.get(name);
      const first = join(partial, String(UNPINNED_VERSION));
      if (from && existsSync(from)) {
        cpSync(from, first, { recursive: true, filter: publishable });
        writeFirstManifest(name, first);
        renameSync(partial, at);
        return { name, state: "seeded", note: `copied from ${from}` };
      }
      mkdirSync(first, { recursive: true });
      writeFirstManifest(name, first);
      renameSync(partial, at);
      return { name, state: "created", note: "empty" };
    } catch (e) {
      rmSync(partial, { recursive: true, force: true });
      return { name, state: "failed", note: (e as Error).message.trim() };
    }
  }

  /** A library still in one folder becomes its own version 1, moved whole — the songs that read it hear the same files. */
  private migrate(name: string): LibraryNote {
    const at = join(this.home, name);
    if (versionNumbers(at).length || existsSync(join(at, DRAFT_VERSION)))
      return { name, state: "current", note: "here" };
    const moving = join(this.home, `.migrating-${Date.now()}-${process.pid}`);
    try {
      renameSync(at, moving);
      mkdirSync(at);
      const first = join(at, String(UNPINNED_VERSION));
      renameSync(moving, first);
      writeFirstManifest(name, first);
      return { name, state: "current", note: "moved into version 1" };
    } catch (e) {
      // Put the folder back where it was, whatever step failed.
      if (existsSync(moving) && !existsSync(join(at, "1"))) {
        rmSync(at, { recursive: true, force: true });
        renameSync(moving, at);
      }
      return { name, state: "failed", note: (e as Error).message.trim() };
    }
  }

  /** Give library `name` the draft its admins edit, copied from its newest version; null when it already has one. */
  private ensureDraft(name: string): LibraryNote | null {
    const at = join(this.home, name);
    const draft = join(at, DRAFT_VERSION);
    if (existsSync(draft)) return null;
    const newest = Math.max(0, ...versionNumbers(at));
    const partial = join(this.home, `.drafting-${Date.now()}-${process.pid}`);
    const manifest = join(at, String(newest), LIBRARY_MANIFEST);
    try {
      if (newest)
        cpSync(join(at, String(newest)), partial, {
          recursive: true,
          filter: (src) => resolve(src) !== manifest,
        });
      else mkdirSync(partial, { recursive: true });
      renameSync(partial, draft);
      return {
        name,
        state: "current",
        note: newest ? `draft copied from version ${newest}` : "empty draft",
      };
    } catch (e) {
      rmSync(partial, { recursive: true, force: true });
      return { name, state: "failed", note: (e as Error).message.trim() };
    }
  }
}

/** What a published version carries: never a `.git`, never a recycle bin. */
const publishable = (src: string): boolean =>
  !src.split(/[\\/]/).some((s) => s === ".git" || s === RECYCLE_DIR);

/** The published version numbers under a library's folder, ascending. */
function versionNumbers(at: string): number[] {
  try {
    return readdirSync(at, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => versionOfDir(d.name))
      .filter((v): v is number => typeof v === "number")
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

function readManifest(dir: string): LibraryManifest | null {
  try {
    return parseLibraryManifest(
      readFileSync(join(dir, LIBRARY_MANIFEST), "utf8"),
    );
  } catch {
    return null;
  }
}

/** Version 1 of a library written before versions: it asks for nothing past the first level. */
function writeFirstManifest(name: string, dir: string): void {
  if (existsSync(join(dir, LIBRARY_MANIFEST))) return;
  writeFileSync(
    join(dir, LIBRARY_MANIFEST),
    stringifyLibraryManifest({ name, version: UNPINNED_VERSION, requires: 1 }),
  );
}
