// The watcher's whole job is answering one question — "have the module folders moved?" — and
// the only answer that can hurt is a wrong `true`. So every test here is about when it says
// false: before it knows anything, after an event, and when the ceiling runs out.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadModuleRefs,
  loadModules,
  withModuleStamp,
} from "@studio/song/loader";
import { setFoldersStill } from "@studio/song/moduleCache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeFeed } from "./liveCapture.ts";
import {
  closeModuleWatch,
  moduleFoldersMoved,
  moduleFoldersStill,
  WALK_ANYWAY_MS,
  watchedProjects,
  watchModuleFolders,
} from "./moduleWatch.ts";

let root = "";
let dir = "";

// A module now lives at `@workspace` — beside the project, in `_modules` — never inside it.
const module_ = (name: string): void => {
  mkdirSync(join(root, "_modules", "audio", name), { recursive: true });
  writeFileSync(
    join(root, "_modules", "audio", name, "module.yaml"),
    `# ${name}\nplugin:\n  type: internal\n  name: Mixer\n`,
    "utf8",
  );
};

// A node stays project-local, which is what "keeps two projects apart" below exercises.
const node_ = (dirAt: string, name: string): void => {
  mkdirSync(join(dirAt, "nodes"), { recursive: true });
  writeFileSync(
    join(dirAt, "nodes", `${name}.yaml`),
    `plugin:\n  type: internal\n  name: Mixer\n`,
    "utf8",
  );
};

// A watch arms asynchronously and never reports a change made before it is live (the ceiling's job), so the change repeats until seen.
const seen = (change: () => void, check: () => void): Promise<void> =>
  vi.waitFor(
    () => {
      change();
      check();
    },
    { timeout: 5000, interval: 50 },
  );

// A quiet period, for the one place the point is to let a write's late event land BEFORE a watch opens.
const settle = (ms = 500): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "module-watch-"));
  dir = join(root, "song.k7");
  // `nodes/` must exist before the watch attaches, or that root is silently uncovered.
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(join(dir, "project.yaml"), "project:\n  name: t\n", "utf8");
  module_("reverb");
});
afterEach(() => {
  closeModuleWatch();
  setFoldersStill(null); // never leave the oracle installed for the next file
  rmSync(root, { recursive: true, force: true });
});

describe("moduleFoldersStill", () => {
  it("says no for a project nobody is watching", () => {
    expect(moduleFoldersStill(dir)).toBe(false);
  });

  // The first ask is a NO: the watcher has seen no events, but neither has it seen the folders.
  it("says no once, then yes while nothing happens", () => {
    watchModuleFolders(dir);
    expect(moduleFoldersStill(dir)).toBe(false);
    expect(moduleFoldersStill(dir)).toBe(true);
    expect(moduleFoldersStill(dir)).toBe(true);
  });

  it("says no again after a module appears", async () => {
    watchModuleFolders(dir);
    moduleFoldersStill(dir); // the first, forced no
    expect(moduleFoldersStill(dir)).toBe(true);
    await seen(
      () => module_("delay"),
      () => expect(moduleFoldersStill(dir)).toBe(false),
    );
    expect(moduleFoldersStill(dir)).toBe(true); // …and settles again
  });

  it("says no again after a module file is edited", async () => {
    watchModuleFolders(dir);
    moduleFoldersStill(dir);
    expect(moduleFoldersStill(dir)).toBe(true);
    await seen(
      () =>
        writeFileSync(
          join(root, "_modules", "audio", "reverb", "module.yaml"),
          "# reverb\nplugin:\n  type: internal\n  name: Mixer\nparams:\n  Volume: 3\n",
          "utf8",
        ),
      () => expect(moduleFoldersStill(dir)).toBe(false),
    );
  });

  it("stops claiming anything once closed", () => {
    watchModuleFolders(dir);
    moduleFoldersStill(dir);
    expect(moduleFoldersStill(dir)).toBe(true);
    closeModuleWatch(dir);
    expect(moduleFoldersStill(dir)).toBe(false);
  });

  // One watch per PROJECT, so a change to one does not cost the other session its answer —
  // exercised on `nodes/`, the one root that stays project-local (a module now lives at
  // `@workspace`, shared by both).
  it("keeps two projects apart", async () => {
    const other = join(root, "other.k7");
    node_(other, "chorus");
    await settle(); // macOS FSEvents delivers that write late, to a watch opened after it
    watchModuleFolders(dir);
    watchModuleFolders(other);
    moduleFoldersStill(dir);
    moduleFoldersStill(other);
    expect(moduleFoldersStill(dir)).toBe(true);
    expect(moduleFoldersStill(other)).toBe(true);

    // …only the first one moves.
    await seen(
      () => node_(dir, "delay"),
      () => expect(moduleFoldersStill(dir)).toBe(false),
    );
    expect(moduleFoldersStill(other)).toBe(true);

    // …and closing one leaves the other watching.
    closeModuleWatch(dir);
    expect(moduleFoldersStill(dir)).toBe(false);
    expect(moduleFoldersStill(other)).toBe(true);
  });

  it("forgets the project once closed", () => {
    watchModuleFolders(dir);
    closeModuleWatch(dir);
    expect(watchedProjects()).toEqual([]);
  });

  // The ceiling makes a MISSED event a delay rather than a permanent lie, hence a readable number.
  it("keeps a ceiling on how long it may be believed", () => {
    expect(WALK_ANYWAY_MS).toBeGreaterThan(0);
    expect(WALK_ANYWAY_MS).toBeLessThanOrEqual(60_000);
  });
});

// The `@workspace` refs this project resolves, stripped of the type folder — what the oracle governs.
const workspaceAudioRefs = (d: string): string[] =>
  Object.keys(loadModuleRefs(d))
    .filter((r) => r.startsWith("@workspace/audio/"))
    .map((r) => r.slice("@workspace/audio/".length))
    .sort();

// A held stamp must not outlive a change to the folders, whatever the watcher's opinion.
describe("the vocabulary the oracle governs", () => {
  it("still sees a module added while it is installed", async () => {
    watchModuleFolders(dir);
    setFoldersStill(moduleFoldersStill);
    expect(workspaceAudioRefs(dir)).toEqual(["reverb"]);
    await seen(
      () => module_("delay"),
      () => expect(workspaceAudioRefs(dir)).toEqual(["delay", "reverb"]),
    );
  });

  /** The case a watcher gets WRONG on its own, and why `moduleFoldersMoved` exists — docs/moduleWatch.md. */
  it("sees a module this process just wrote, before any event arrives", () => {
    watchModuleFolders(dir);
    setFoldersStill(moduleFoldersStill);
    expect(workspaceAudioRefs(dir)).toEqual(["reverb"]);
    moduleFoldersStill(dir); // settle: from here it would claim nothing moved
    module_("delay");
    moduleFoldersMoved();
    expect(workspaceAudioRefs(dir)).toEqual(["delay", "reverb"]);
  });

  // …and the scope still wins inside itself: a derivation is a still frame either way.
  it("holds one answer for the length of a scope", () => {
    watchModuleFolders(dir);
    setFoldersStill(moduleFoldersStill);
    loadModules(dir);
    const seen = withModuleStamp(dir, () => {
      const before = workspaceAudioRefs(dir);
      module_("delay");
      return { before, after: workspaceAudioRefs(dir) };
    });
    expect(seen.after).toEqual(seen.before);
  });
});

/** A feed rooted at the workspace, told by hand what moved — the capture's, without its watcher. */
function fakeFeed(at: string): ChangeFeed & { say(rel: string): void } {
  const fns = new Set<(rel: string, gen: number) => void>();
  let generation = 0;
  return {
    root: at,
    get generation() {
      return generation;
    },
    onChange(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    say(rel) {
      generation++;
      for (const fn of fns) fn(rel, generation);
    },
  };
}

// A root inside the capture's workspace is heard through its feed, and needs no handle of its own.
describe("a watch heard through the capture's feed", () => {
  it("moves on a path under one of its roots", () => {
    const feed = fakeFeed(root);
    watchModuleFolders(dir, feed);
    moduleFoldersStill(dir);
    expect(moduleFoldersStill(dir)).toBe(true);
    feed.say("_modules/audio/reverb/module.yaml");
    expect(moduleFoldersStill(dir)).toBe(false);
    feed.say("song.k7/nodes/chorus.yaml");
    expect(moduleFoldersStill(dir)).toBe(false);
  });

  it("moves when a folder holding a root moves whole", () => {
    const feed = fakeFeed(root);
    watchModuleFolders(dir, feed);
    moduleFoldersStill(dir);
    feed.say("song.k7");
    expect(moduleFoldersStill(dir)).toBe(false);
  });

  it("ignores a path under none of its roots", () => {
    const feed = fakeFeed(root);
    watchModuleFolders(dir, feed);
    moduleFoldersStill(dir);
    feed.say("song.k7/media/take-01.wav");
    feed.say("other.k7/nodes/x.yaml");
    expect(moduleFoldersStill(dir)).toBe(true);
  });

  // The workspace's capture can be replaced; a watch kept on the stopped one would hear nothing.
  it("follows a new feed, and lets go of the old one", () => {
    const first = fakeFeed(root);
    const second = fakeFeed(root);
    watchModuleFolders(dir, first);
    watchModuleFolders(dir, second);
    moduleFoldersStill(dir);
    first.say("_modules/audio/reverb/module.yaml");
    expect(moduleFoldersStill(dir)).toBe(true);
    second.say("_modules/audio/reverb/module.yaml");
    expect(moduleFoldersStill(dir)).toBe(false);
  });
});
