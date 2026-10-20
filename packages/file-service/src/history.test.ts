// The undo/redo journal: ProjectHistory's round-trips (text inline, binary as blobs, ring
// eviction, redo-tail truncation, on-disk persistence), its blobs kept by an ENGINE — faked here —
// and Workspace.recordChange, which is how a real edit reaches it. What must never happen is the
// silent part: an undo that half-applies because the audio it needs is on another engine.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type BlobKeeper,
  type EngineRef,
  historyStoreFor,
  ProjectHistory,
} from "./history.ts";
import { Workspace } from "./workspace.ts";

let dir: string;
const read = (rel: string): string => readFileSync(join(dir, rel), "utf8");
/** The journal's own folder, apart from the project it writes back to. */
const store = (): string => join(dir, ".journal");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-history-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** An engine's machine as the journal sees it: what it was handed, and which engine is bound now. */
function fakeEngines(first: EngineRef | null) {
  const held = new Map<string, Map<string, Buffer>>();
  const r = { bound: first, held };
  const keeper: BlobKeeper = {
    engine: () => r.bound,
    keep: async (files) => {
      if (!r.bound) return false;
      const on = held.get(r.bound.id) ?? new Map<string, Buffer>();
      for (const f of files) on.set(f, readFileSync(f));
      held.set(r.bound.id, on);
      return true;
    },
    fetch: async (file) => {
      const bytes = r.bound && held.get(r.bound.id)?.get(file);
      if (!bytes) return false;
      writeFileSync(file, bytes);
      return true;
    },
  };
  return { r, keeper };
}

const STUDIO_A = { id: "e-a", name: "studio A" };
const STUDIO_B = { id: "e-b", name: "studio B" };

/** A bounce of `r.wav` from "old" to "new", recorded with an edit of its clip file. */
function bounce(h: ProjectHistory): void {
  writeFileSync(join(dir, "r.wav"), "new");
  writeFileSync(join(dir, "r.k7x"), "v2");
  h.push({
    label: "clip process",
    changes: [{ path: "r.k7x", before: "v1", after: "v2" }],
    blobs: [
      { path: "r.wav", before: Buffer.from("old"), after: Buffer.from("new") },
    ],
  });
}

describe("ProjectHistory", () => {
  it("round-trips a text change and reports which file it touched", async () => {
    writeFileSync(join(dir, "a.k7x"), "v2");
    const h = new ProjectHistory(store(), dir);
    h.push({
      label: "edit a.k7x",
      changes: [{ path: "a.k7x", before: "v1", after: "v2" }],
      blobs: [],
    });

    const undone = await h.undo();
    expect(undone).toEqual({
      kind: "text",
      label: "edit a.k7x",
      files: ["a.k7x"],
    });
    expect(read("a.k7x")).toBe("v1");

    const redone = await h.redo();
    expect(redone?.files).toEqual(["a.k7x"]);
    expect(read("a.k7x")).toBe("v2");
  });

  it("undo of a created file deletes it, redo re-creates it", async () => {
    writeFileSync(join(dir, "new.k7x"), "hello");
    const h = new ProjectHistory(store(), dir);
    h.push({
      label: "add new.k7x",
      changes: [{ path: "new.k7x", before: null, after: "hello" }],
      blobs: [],
    });
    await h.undo();
    expect(existsSync(join(dir, "new.k7x"))).toBe(false);
    await h.redo();
    expect(read("new.k7x")).toBe("hello");
  });

  it("round-trips a binary blob and marks the entry a process, with no engine to keep it", async () => {
    const h = new ProjectHistory(store(), dir);
    bounce(h);
    expect(h.peekUndo()?.kind).toBe("process");
    await h.undo();
    expect(read("r.wav")).toBe("old");
    await h.redo();
    expect(read("r.wav")).toBe("new");
  });

  it("a fresh push truncates the redo tail", async () => {
    const h = new ProjectHistory(store(), dir);
    const change = (p: string, after: string) => ({
      label: p,
      changes: [{ path: p, before: null, after }],
      blobs: [],
    });
    h.push(change("a.k7x", "A"));
    h.push(change("b.k7x", "B"));
    await h.undo(); // b.k7x undone; cursor sits after a.k7x
    h.push(change("c.k7x", "C")); // forks history — b.k7x's redo is gone
    expect(h.peekRedo()).toBeNull();
    expect(h.peekUndo()?.files).toEqual(["c.k7x"]);
  });

  it("lists every entry oldest first, its paths and not its contents, the undone ones marked", async () => {
    const h = new ProjectHistory(store(), dir);
    const change = (p: string, after: string) => ({
      label: `edit ${p}`,
      changes: [{ path: p, before: null, after }],
      blobs: [],
    });
    h.push(change("a.k7x", "A"));
    h.push(change("b.k7x", "B"));
    await h.undo();
    const list = h.list();
    expect(list.map((e) => [e.label, e.paths, e.undone])).toEqual([
      ["edit a.k7x", ["a.k7x"], false],
      ["edit b.k7x", ["b.k7x"], true],
    ]);
    expect(list[0]).not.toHaveProperty("changes");
  });

  it("keeps at most 1000 entries, evicting the oldest", () => {
    const h = new ProjectHistory(store(), dir);
    for (let n = 0; n < 1005; n++)
      h.push({
        label: `e${n}`,
        changes: [{ path: `f${n}.k7x`, before: null, after: `${n}` }],
        blobs: [],
      });
    // Read the journal off disk rather than undoing 1000× (each undo is a filesystem write).
    const j = JSON.parse(
      readFileSync(join(store(), "journal.json"), "utf8"),
    ) as {
      cursor: number;
      entries: { label: string }[];
    };
    expect(j.entries.length).toBe(1000);
    expect(j.cursor).toBe(1000);
    expect(j.entries[0].label).toBe("e5"); // e0..e4 evicted from the front
    expect(j.entries.at(-1)?.label).toBe("e1004");
  });

  // One gesture written by two commands — a node created, then spliced — is ONE step to undo.
  it("joins a change into the step on top, keeping each file's first before", async () => {
    writeFileSync(join(dir, "graph.k7x"), "g3");
    writeFileSync(join(dir, "fx.k7x"), "node");
    const h = new ProjectHistory(store(), dir);
    h.push({
      label: "node new",
      changes: [
        { path: "fx.k7x", before: null, after: "node" },
        { path: "graph.k7x", before: "g1", after: "g2" },
      ],
      blobs: [],
    });
    h.join({
      label: "node insert",
      changes: [{ path: "graph.k7x", before: "g2", after: "g3" }],
      blobs: [],
    });
    expect(h.list()).toHaveLength(1);
    await h.undo();
    expect(read("graph.k7x")).toBe("g1");
    expect(existsSync(join(dir, "fx.k7x"))).toBe(false);
    expect(h.state().canUndo).toBe(false);
    await h.redo();
    expect(read("graph.k7x")).toBe("g3");
    expect(read("fx.k7x")).toBe("node");
  });

  it("joins nothing past an undo, and drops a step that ends where it began", async () => {
    const h = new ProjectHistory(store(), dir);
    const change = (
      p: string,
      before: string | null,
      after: string | null,
    ) => ({
      label: p,
      changes: [{ path: p, before, after }],
      blobs: [],
    });
    h.join(change("a.k7x", null, "A"));
    expect(h.list()).toHaveLength(1);
    await h.undo();
    h.join(change("b.k7x", null, "B"));
    expect(h.list().map((e) => e.label)).toEqual(["b.k7x"]);
    h.join(change("b.k7x", "B", null));
    expect(h.list()).toEqual([]);
  });

  it("persists across instances", async () => {
    writeFileSync(join(dir, "a.k7x"), "v2");
    new ProjectHistory(store(), dir).push({
      label: "edit a.k7x",
      changes: [{ path: "a.k7x", before: "v1", after: "v2" }],
      blobs: [],
    });
    // A new instance reads the journal off disk and can still undo.
    const reopened = new ProjectHistory(store(), dir);
    expect((await reopened.undo())?.files).toEqual(["a.k7x"]);
    expect(read("a.k7x")).toBe("v1");
  });
});

describe("blobs kept by the engine", () => {
  it("hands them to the bound engine, keeps no copy, and fetches one back for an undo", async () => {
    const { keeper } = fakeEngines(STUDIO_A);
    const h = new ProjectHistory(store(), dir, keeper);
    bounce(h);
    await h.settled();
    expect(existsSync(join(store(), "blobs", "1-b0"))).toBe(false);
    await h.undo();
    expect(read("r.wav")).toBe("old");
    expect(read("r.k7x")).toBe("v1");
    // The fetched copy was for that write only: the engine still holds it.
    expect(existsSync(join(store(), "blobs", "1-b0"))).toBe(false);
    await h.redo();
    expect(read("r.wav")).toBe("new");
  });

  // The person changed engine: the audio is on the other one, and half an undo would corrupt the song.
  it("refuses an undo whose audio another engine keeps, naming it, and writes nothing", async () => {
    const { r, keeper } = fakeEngines(STUDIO_A);
    const h = new ProjectHistory(store(), dir, keeper);
    bounce(h);
    await h.settled();
    writeFileSync(join(dir, "a.k7x"), "later");
    h.push({
      label: "edit a.k7x",
      changes: [{ path: "a.k7x", before: "earlier", after: "later" }],
      blobs: [],
    });
    r.bound = STUDIO_B;
    // A text step above it still undoes…
    await h.undo();
    expect(read("a.k7x")).toBe("earlier");
    // …and the bounce is where it stops.
    await expect(h.undo()).rejects.toThrow(/studio A/);
    expect(read("r.wav")).toBe("new");
    expect(read("r.k7x")).toBe("v2");
    expect(h.peekUndo()?.label).toBe("clip process");
    // Back on the engine that keeps it, the same undo goes through.
    r.bound = STUDIO_A;
    await h.undo();
    expect(read("r.wav")).toBe("old");
  });

  it("says so when the engine no longer has the audio", async () => {
    const { r, keeper } = fakeEngines(STUDIO_A);
    const h = new ProjectHistory(store(), dir, keeper);
    bounce(h);
    await h.settled();
    r.held.clear();
    await expect(h.undo()).rejects.toThrow(/no longer has/);
    expect(read("r.wav")).toBe("new");
  });

  it("undoes from the copy here while the engine has not taken it yet", async () => {
    const { keeper } = fakeEngines(STUDIO_A);
    const h = new ProjectHistory(store(), dir, {
      ...keeper,
      keep: async () => false,
    });
    bounce(h);
    await h.settled();
    await h.undo();
    expect(read("r.wav")).toBe("old");
  });
});

describe("Workspace.recordChange", () => {
  // A workspace whose root holds one `.k7` project, made active.
  afterEach(() => {
    rmSync(historyStoreFor(join(dir, "proj.k7")), {
      recursive: true,
      force: true,
    });
  });
  const openProject = (): { ws: Workspace; proj: string } => {
    mkdirSync(join(dir, "proj.k7"));
    const ws = new Workspace(dir);
    ws.setActiveProject("proj.k7");
    return { ws, proj: "proj.k7" };
  };

  it("journals a text edit and undo/redo reverts it", async () => {
    const { ws } = openProject();
    writeFileSync(join(dir, "proj.k7", "a.k7x"), "v1");

    await ws.recordChange("édition proj.k7/a.k7x", () =>
      ws.write("proj.k7/a.k7x", "v2"),
    );
    expect(read("proj.k7/a.k7x")).toBe("v2");

    const undone = await ws.history.undo();
    expect(undone?.files).toEqual(["proj.k7/a.k7x"]);
    expect(read("proj.k7/a.k7x")).toBe("v1");

    await ws.history.redo();
    expect(read("proj.k7/a.k7x")).toBe("v2");
  });

  it("backs up a binary overwrite via the snapshot hook (a process)", async () => {
    const { ws } = openProject();
    const wav = join(dir, "proj.k7", "r.wav");
    writeFileSync(wav, Buffer.from("old"));

    await ws.recordChange("clip process", (snapshot) => {
      snapshot(wav); // the render backs itself up before overwriting
      writeFileSync(wav, Buffer.from("new"));
    });
    expect(ws.history.peekUndo()?.kind).toBe("process");

    await ws.history.undo();
    expect(read("proj.k7/r.wav")).toBe("old");
  });

  // The journal is the account's, not the song's: nothing of it may reach the project's repository.
  it("keeps the journal out of the project", async () => {
    const { ws } = openProject();
    await ws.recordChange("edit", () => ws.write("proj.k7/a.k7x", "v1"));
    expect(existsSync(join(dir, "proj.k7", "_history"))).toBe(false);
    expect(
      existsSync(join(historyStoreFor(join(dir, "proj.k7")), "journal.json")),
    ).toBe(true);
  });

  it("folds a joined command into the step before it, byte for byte on undo", async () => {
    const { ws } = openProject();
    const graph = "in -> out\n";
    writeFileSync(join(dir, "proj.k7", "graph.k7x"), graph);
    await ws.recordChange("node new fx", () => {
      ws.write("proj.k7/fx.k7x", "module: fx\n");
      ws.write("proj.k7/graph.k7x", `${graph}fx\n`);
    });
    await ws.recordChange(
      "node insert in out fx",
      () => ws.write("proj.k7/graph.k7x", "in -> fx -> out\n"),
      "join",
    );
    expect(ws.history.list()).toHaveLength(1);
    await ws.history.undo();
    expect(read("proj.k7/graph.k7x")).toBe(graph);
    expect(existsSync(join(dir, "proj.k7", "fx.k7x"))).toBe(false);
    expect(ws.history.state().canUndo).toBe(false);
  });

  // The graph pinning its own layout as a project opens: nobody made it, so Ctrl+Z must reach past it.
  it("keeps a skipped write out of the journal, and still names what it wrote", async () => {
    const { ws } = openProject();
    writeFileSync(join(dir, "proj.k7", "graph.k7x"), "in -> out\n");
    await ws.recordChange("edit", () => ws.write("proj.k7/a.k7x", "v1"));
    const pin = await ws.recordChange(
      "graph pin",
      () => ws.write("proj.k7/graph.k7x", "in -> out\npositions: {}\n"),
      "skip",
    );
    expect(pin.files).toEqual([{ path: "graph.k7x", kind: "edited" }]);
    expect(ws.history.list().map((e) => e.label)).toEqual(["edit"]);
    await ws.history.undo();
    expect(existsSync(join(dir, "proj.k7", "a.k7x"))).toBe(false);
    expect(read("proj.k7/graph.k7x")).toBe("in -> out\npositions: {}\n");
  });

  it("records nothing when the mutation changed no files", async () => {
    const { ws } = openProject();
    await ws.recordChange("noop", () => {});
    expect(ws.history.state().canUndo).toBe(false);
  });

  // The same diff said the other way: the journal's paths are workspace-relative, these the project's.
  describe("names what it changed", () => {
    it("tells a rewrite from an appearance, project-relative", async () => {
      const { ws } = openProject();
      mkdirSync(join(dir, "proj.k7", "clips"));
      writeFileSync(join(dir, "proj.k7", "clips", "a.k7x"), "v1");

      const rewrite = await ws.recordChange("edit", () =>
        ws.write("proj.k7/clips/a.k7x", "v2"),
      );
      expect(rewrite.files).toEqual([{ path: "clips/a.k7x", kind: "edited" }]);

      const appear = await ws.recordChange("new", () =>
        ws.write("proj.k7/clips/b.k7x", "v1"),
      );
      expect(appear.files).toEqual([{ path: "clips/b.k7x", kind: "added" }]);
    });

    it("reports a file that went", async () => {
      const { ws } = openProject();
      writeFileSync(join(dir, "proj.k7", "a.k7x"), "v1");
      const gone = await ws.recordChange("delete", () =>
        rmSync(join(dir, "proj.k7", "a.k7x")),
      );
      expect(gone.files).toEqual([{ path: "a.k7x", kind: "removed" }]);
    });

    it("answers an empty list when the mutation wrote nothing", async () => {
      const { ws } = openProject();
      const nothing = await ws.recordChange("noop", () => {});
      expect(nothing.files).toEqual([]);
    });

    // …and NULL when there was no diff to take, which a client must not read as "nothing".
    it("answers null with no project open", async () => {
      const ws = new Workspace(dir);
      const none = await ws.recordChange("noop", () => {});
      expect(none.files).toBeNull();
    });
  });
});
