// libraries.ts — the origin's LIBRARIES, held by the hub: the one list (`<dataRoot>/libraries.json`),
// the SERVER's key, and ONE clone of each library under `<dataRoot>/libraries/<name>`, which every
// account's file service reads and nobody writes. A sync only FETCHES a clone already here; it moves
// on a `pull` — an admin's from the Libraries page, or a bench's push. The hub is one process, so
// its in-memory serialisation is the only lock these clones need. See docs/fileHub.md.

import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { generateKey, gitEnv } from "@studio/git-repos/keys";
import {
  assertSshGitUri,
  normalizeGitUri,
  repoName,
} from "@studio/git-repos/uri";
import {
  DEFAULT_LIBRARY,
  isLibraryName,
} from "@studio/song-schema/moduleTypes";
import type { AccountLibrariesReply, LibraryNote } from "@studio/web-protocol";

const run = promisify(execFile);

/** Bounded like every other git call: a hung fetch must not hold a request open. */
const TIMEOUT_MS = 120_000;

/** How recent a sync must be for an ordinary refresh to skip it; an explicit one never skips. */
const SYNC_EVERY_MS = 60_000;

/** One library of the origin: the name its refs use (`@<name>/…`) and where it is cloned from. */
export interface LibrarySetting {
  name: string;
  uri: string;
}

/** Why `list` cannot be the origin's libraries, or null when it can. */
export function settingsProblem(list: LibrarySetting[]): string | null {
  const names = new Set<string>();
  const uris = new Set<string>();
  for (const l of list) {
    if (!isLibraryName(l.name))
      return `'${l.name}' cannot name a library — lowercase letters, digits and dashes, and not engine, workspace or meta`;
    if (names.has(l.name)) return `two libraries are called '${l.name}'`;
    names.add(l.name);
    try {
      assertSshGitUri(l.uri);
    } catch {
      return `not an SSH git URI: ${l.uri || "(empty)"}`;
    }
    const n = normalizeGitUri(l.uri);
    if (uris.has(n)) return `${l.uri} is listed twice`;
    uris.add(n);
  }
  return null;
}

/** The name a library gets when none is given: `st0` for the first, else its repository's. */
export function defaultLibraryName(
  uri: string,
  taken: LibrarySetting[],
): string {
  if (!taken.length) return DEFAULT_LIBRARY;
  return repoName(uri)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A `libraries.json` read as a list: the old single `{ uri }` is a library called `st0`; anything unreadable is none. */
function parseList(text: string): LibrarySetting[] {
  let raw: { uri?: unknown; libraries?: unknown };
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof raw?.uri === "string" && raw.uri)
    return [{ name: DEFAULT_LIBRARY, uri: raw.uri }];
  if (!Array.isArray(raw?.libraries)) return [];
  const out: LibrarySetting[] = [];
  for (const l of raw.libraries as { name?: unknown; uri?: unknown }[])
    if (
      typeof l?.name === "string" &&
      typeof l?.uri === "string" &&
      isLibraryName(l.name) &&
      !out.some((o) => o.name === l.name)
    )
      out.push({ name: l.name, uri: l.uri });
  return out;
}

/** Does the folder hold anything? A clone that never finished is removed, so empty means absent. */
const isPopulated = (dir: string): boolean => {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
};

export class LibraryStore {
  /** Where the clones are — what every file service gets as `$STUDIO_LIBRARIES_HOME`. */
  readonly home: string;
  private readonly listFile: string;
  private readonly keyDir: string;
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly lastSync = new Map<string, number>();
  private readonly failures = new Map<string, string>();
  /** Commits each clone's remote has that the clone does not, as of the last fetch. */
  private readonly behind = new Map<string, number>();

  constructor(private readonly dataRoot: string) {
    this.home = join(dataRoot, "libraries");
    this.listFile = join(dataRoot, "libraries.json");
    this.keyDir = join(dataRoot, ".libraries-key");
  }

  /** The list. With none written yet, every account's former list, merged — each account used to keep its own. */
  settings(): LibrarySetting[] {
    if (existsSync(this.listFile))
      return parseList(readFileSync(this.listFile, "utf8"));
    const merged: LibrarySetting[] = [];
    let accounts: string[] = [];
    try {
      accounts = readdirSync(this.dataRoot);
    } catch {
      /* no data root yet */
    }
    for (const a of accounts.sort()) {
      let text: string;
      try {
        text = readFileSync(join(this.dataRoot, a, "libraries.json"), "utf8");
      } catch {
        continue;
      }
      for (const l of parseList(text))
        if (!settingsProblem([...merged, l])) merged.push(l);
    }
    return merged;
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

  /** The server's public key, made on first ask: what each library repository must accept, read-only. */
  key(): Promise<string> {
    return generateKey(this.keyDir, "studio-libraries");
  }

  /** The list as an account sees it: each library, whether the server holds it, and why not. */
  view(notes?: LibraryNote[]): AccountLibrariesReply {
    const reply: AccountLibrariesReply = {
      libraries: this.settings().map((l) => {
        const error = this.failures.get(l.name);
        const behind = this.behind.get(l.name) ?? 0;
        return {
          ...l,
          cloned: isPopulated(join(this.home, l.name)),
          ...(error ? { error } : {}),
          ...(behind ? { behind } : {}),
        };
      }),
    };
    if (notes?.length) reply.notes = notes;
    return reply;
  }

  /** SET the list: what is new or moved is CLONED first, and a clone that fails stores nothing. */
  async set(
    asked: { name?: string; uri: string }[],
  ): Promise<{ ok: true; reply: AccountLibrariesReply } | { error: string }> {
    const before = this.settings();
    const list: LibrarySetting[] = [];
    for (const l of asked)
      list.push({
        name: l.name || defaultLibraryName(l.uri, list),
        uri: l.uri,
      });
    const problem = settingsProblem(list);
    if (problem) return { error: problem };
    const fresh = list.filter(
      (l) => !before.some((b) => b.name === l.name && b.uri === l.uri),
    );
    const notes = await Promise.all(fresh.map((l) => this.syncOne(l, true)));
    const failed = notes.filter((n) => n.state === "failed");
    if (failed.length)
      return {
        error: failed
          .map(
            (n) =>
              `could not clone '${n.name}' — ${n.note} (is the server's key a deploy key of that repository?)`,
          )
          .join("; "),
      };
    this.write(list);
    this.prune();
    return { ok: true, reply: this.view(notes) };
  }

  /** Fetch the clones, all or only `name`, cloning a missing one; `pull` also MOVES them. Waited for only where one is missing, unless `force` or `pull`. */
  async sync(
    opts: { name?: string; force?: boolean; pull?: boolean } = {},
  ): Promise<LibraryNote[]> {
    if (opts.pull) opts = { ...opts, force: true };
    const now = Date.now();
    const due = this.settings().filter(
      (l) =>
        (!opts.name || l.name === opts.name) &&
        (opts.force ||
          !isPopulated(join(this.home, l.name)) ||
          now - (this.lastSync.get(l.name) ?? 0) >= SYNC_EVERY_MS),
    );
    const missing = due.filter((l) => !isPopulated(join(this.home, l.name)));
    const all = Promise.all(
      due.map((l) => this.syncOne(l, opts.force, opts.pull)),
    );
    if (opts.force || missing.length) return all;
    // Clones already here update behind the answer: an unreachable host must not hold a song back.
    void all.catch(() => undefined);
    return [];
  }

  /** One library, cloned when absent, else fetched — and made EXACTLY its remote on a `pull`: nothing here is anyone's work. */
  private syncOne(
    lib: LibrarySetting,
    force = false,
    pull = false,
  ): Promise<LibraryNote> {
    return this.serial(lib.name, async (): Promise<LibraryNote> => {
      const at = join(this.home, lib.name);
      if (
        !force &&
        isPopulated(at) &&
        Date.now() - (this.lastSync.get(lib.name) ?? 0) < SYNC_EVERY_MS
      )
        return { name: lib.name, state: "current", note: "up to date" };
      try {
        await this.key();
        const env = gitEnv(this.keyDir);
        let note: LibraryNote;
        if (
          !isPopulated(at) ||
          (await this.origin(at)) !== normalizeGitUri(lib.uri)
        ) {
          await this.cloneInto(at, lib.uri, env);
          note = { name: lib.name, state: "cloned", note: `cloned ${lib.uri}` };
        } else {
          await this.git(at, ["fetch", "--prune", "origin"], env);
          const before = await this.head(at, env);
          // An empty repository has no upstream yet: there is nothing to be at.
          const upstream = await this.hasUpstream(at, env);
          if (pull && upstream) {
            await this.git(at, ["reset", "--hard", "-q", "@{u}"], env);
            await this.git(at, ["clean", "-fdq"], env);
          }
          const after = await this.head(at, env);
          const behind = upstream ? await this.countBehind(at, env) : 0;
          this.behind.set(lib.name, behind);
          note =
            before !== after
              ? {
                  name: lib.name,
                  state: "updated",
                  note: `updated to ${after.slice(0, 7)}`,
                }
              : behind
                ? {
                    name: lib.name,
                    state: "behind",
                    note: `${behind} commit(s) to pull`,
                  }
                : { name: lib.name, state: "current", note: "up to date" };
        }
        if (note.state === "cloned") this.behind.delete(lib.name);
        this.failures.delete(lib.name);
        this.lastSync.set(lib.name, Date.now());
        return note;
      } catch (e) {
        const note = (e as Error).message.trim();
        this.failures.set(lib.name, note);
        return { name: lib.name, state: "failed", note };
      }
    });
  }

  /** Remove the clones of libraries the list no longer names — nobody's work lives in them. */
  private prune(): void {
    const listed = new Set(this.settings().map((l) => l.name));
    let names: string[] = [];
    try {
      names = readdirSync(this.home);
    } catch {
      return;
    }
    for (const n of names)
      if (isLibraryName(n) && !listed.has(n)) {
        rmSync(join(this.home, n), { recursive: true, force: true });
        this.lastSync.delete(n);
        this.failures.delete(n);
        this.behind.delete(n);
      }
  }

  /** Clone into a SIBLING and rename it into place: a dot-name is never a library, so no reader sees half of one. */
  private async cloneInto(
    at: string,
    uri: string,
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    mkdirSync(this.home, { recursive: true });
    const partial = join(this.home, `.cloning-${Date.now()}-${process.pid}`);
    try {
      await run("git", ["clone", "-q", "--", uri, partial], {
        env,
        timeout: TIMEOUT_MS,
      });
      rmSync(at, { recursive: true, force: true });
      renameSync(partial, at);
    } finally {
      rmSync(partial, { recursive: true, force: true });
    }
  }

  private git(at: string, args: string[], env: NodeJS.ProcessEnv) {
    return run("git", ["-C", at, ...args], { env, timeout: TIMEOUT_MS });
  }

  /** The URI a clone was MADE with, normalised — `remote get-url` would apply `insteadOf`. */
  private async origin(at: string): Promise<string | null> {
    try {
      const { stdout } = await this.git(
        at,
        ["config", "--get", "remote.origin.url"],
        process.env,
      );
      return normalizeGitUri(stdout.trim());
    } catch {
      return null;
    }
  }

  private async head(at: string, env: NodeJS.ProcessEnv): Promise<string> {
    try {
      return (await this.git(at, ["rev-parse", "HEAD"], env)).stdout.trim();
    } catch {
      return ""; // unborn
    }
  }

  /** How many commits `@{u}` has that HEAD does not — all of them, for a clone made while the repository was empty. */
  private async countBehind(
    at: string,
    env: NodeJS.ProcessEnv,
  ): Promise<number> {
    const range = (await this.head(at, env)) ? "HEAD..@{u}" : "@{u}";
    const { stdout } = await this.git(at, ["rev-list", "--count", range], env);
    return Number.parseInt(stdout.trim(), 10) || 0;
  }

  private async hasUpstream(
    at: string,
    env: NodeJS.ProcessEnv,
  ): Promise<boolean> {
    try {
      await this.git(at, ["rev-parse", "--verify", "-q", "@{u}"], env);
      return true;
    } catch {
      return false;
    }
  }

  /** One git operation per library at a time. */
  private serial<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(name) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.locks.set(name, next);
    return next.finally(() => {
      if (this.locks.get(name) === next) this.locks.delete(name);
    });
  }
}
