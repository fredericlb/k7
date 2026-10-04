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

/** A bounce of `r.wav` from "old" to "new", recorded with an edit of its clip's YAML. */
function bounce(h: ProjectHistory): void {
  writeFileSync(join(dir, "r.wav"), "new");
  writeFileSync(join(dir, "r.yaml"), "v2");
  h.push({
    label: "clip process",
    changes: [{ path: "r.yaml", before: "v1", after: "v2" }],
    blobs: [
      { path: "r.wav", before: Buffer.from("old"), after: Buffer.from("new") },
    ],
  });
}

describe("ProjectHistory", () => {
  it("round-trips a text change and reports which file it touched", async () => {
    writeFileSync(join(dir, "a.yaml"), "v2");
    const h = new ProjectHistory(store(), dir);
    h.push({
      label: "edit a.yaml",
      changes: [{ path: "a.yaml", before: "v1", after: "v2" }],
      blobs: [],
    });

    const undone = await h.undo();
    expect(undone).toEqual({
      kind: "text",
      label: "edit a.yaml",
      files: ["a.yaml"],
    });
    expect(read("a.yaml")).toBe("v1");

    const redone = await h.redo();
    expect(redone?.files).toEqual(["a.yaml"]);
    expect(read("a.yaml")).toBe("v2");
  });

  it("undo of a created file deletes it, redo re-creates it", async () => {
    writeFileSync(join(dir, "new.yaml"), "hello");
    const h = new ProjectHistory(store(), dir);
    h.push({
      label: "add new.yaml",
      changes: [{ path: "new.yaml", before: null, after: "hello" }],
      blobs: [],
    });
    await h.undo();
    expect(existsSync(join(dir, "new.yaml"))).toBe(false);
    await h.redo();
    expect(read("new.yaml")).toBe("hello");
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
    h.push(change("a.yaml", "A"));
    h.push(change("b.yaml", "B"));
    await h.undo(); // b.yaml undone; cursor sits after a.yaml
    h.push(change("c.yaml", "C")); // forks history — b.yaml's redo is gone
    expect(h.peekRedo()).toBeNull();
    expect(h.peekUndo()?.files).toEqual(["c.yaml"]);
  });

  it("keeps at most 1000 entries, evicting the oldest", () => {
    const h = new ProjectHistory(store(), dir);
    for (let n = 0; n < 1005; n++)
      h.push({
        label: `e${n}`,
        changes: [{ path: `f${n}.yaml`, before: null, after: `${n}` }],
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

  it("persists across instances", async () => {
    writeFileSync(join(dir, "a.yaml"), "v2");
    new ProjectHistory(store(), dir).push({
      label: "edit a.yaml",
      changes: [{ path: "a.yaml", before: "v1", after: "v2" }],
      blobs: [],
    });
    // A new instance reads the journal off disk and can still undo.
    const reopened = new ProjectHistory(store(), dir);
    expect((await reopened.undo())?.files).toEqual(["a.yaml"]);
    expect(read("a.yaml")).toBe("v1");
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
    expect(read("r.yaml")).toBe("v1");
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
    writeFileSync(join(dir, "a.yaml"), "later");
    h.push({
      label: "edit a.yaml",
      changes: [{ path: "a.yaml", before: "earlier", after: "later" }],
      blobs: [],
    });
    r.bound = STUDIO_B;
    // A text step above it still undoes…
    await h.undo();
    expect(read("a.yaml")).toBe("earlier");
    // …and the bounce is where it stops.
    await expect(h.undo()).rejects.toThrow(/studio A/);
    expect(read("r.wav")).toBe("new");
    expect(read("r.yaml")).toBe("v2");
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
  // A workspace whose root holds one `.st0` project, made active.
  afterEach(() => {
    rmSync(historyStoreFor(join(dir, "proj.st0")), {
      recursive: true,
      force: true,
    });
  });
  const openProject = (): { ws: Workspace; proj: string } => {
    mkdirSync(join(dir, "proj.st0"));
    const ws = new Workspace(dir);
    ws.setActiveProject("proj.st0");
    return { ws, proj: "proj.st0" };
  };

  it("journals a text edit and undo/redo reverts it", async () => {
    const { ws } = openProject();
    writeFileSync(join(dir, "proj.st0", "a.yaml"), "v1");

    await ws.recordChange("édition proj.st0/a.yaml", () =>
      ws.write("proj.st0/a.yaml", "v2"),
    );
    expect(read("proj.st0/a.yaml")).toBe("v2");

    const undone = await ws.undoHistory();
    expect(undone?.files).toEqual(["proj.st0/a.yaml"]);
    expect(read("proj.st0/a.yaml")).toBe("v1");

    await ws.redoHistory();
    expect(read("proj.st0/a.yaml")).toBe("v2");
  });

  it("backs up a binary overwrite via the snapshot hook (a process)", async () => {
    const { ws } = openProject();
    const wav = join(dir, "proj.st0", "r.wav");
    writeFileSync(wav, Buffer.from("old"));

    await ws.recordChange("clip process", (snapshot) => {
      snapshot(wav); // the render backs itself up before overwriting
      writeFileSync(wav, Buffer.from("new"));
    });
    expect(ws.peekUndo()?.kind).toBe("process");

    await ws.undoHistory();
    expect(read("proj.st0/r.wav")).toBe("old");
  });

  // The journal is the account's, not the song's: nothing of it may reach the project's repository.
  it("keeps the journal out of the project", async () => {
    const { ws } = openProject();
    await ws.recordChange("edit", () => ws.write("proj.st0/a.yaml", "v1"));
    expect(existsSync(join(dir, "proj.st0", "_history"))).toBe(false);
    expect(
      existsSync(join(historyStoreFor(join(dir, "proj.st0")), "journal.json")),
    ).toBe(true);
  });

  it("records nothing when the mutation changed no files", async () => {
    const { ws } = openProject();
    await ws.recordChange("noop", () => {});
    expect(ws.historyState().canUndo).toBe(false);
  });

  // The same diff said the other way: the journal's paths are workspace-relative, these the project's.
  describe("names what it changed", () => {
    it("tells a rewrite from an appearance, project-relative", async () => {
      const { ws } = openProject();
      mkdirSync(join(dir, "proj.st0", "clips"));
      writeFileSync(join(dir, "proj.st0", "clips", "a.yaml"), "v1");

      const rewrite = await ws.recordChange("edit", () =>
        ws.write("proj.st0/clips/a.yaml", "v2"),
      );
      expect(rewrite.files).toEqual([{ path: "clips/a.yaml", kind: "edited" }]);

      const appear = await ws.recordChange("new", () =>
        ws.write("proj.st0/clips/b.yaml", "v1"),
      );
      expect(appear.files).toEqual([{ path: "clips/b.yaml", kind: "added" }]);
    });

    it("reports a file that went", async () => {
      const { ws } = openProject();
      writeFileSync(join(dir, "proj.st0", "a.yaml"), "v1");
      const gone = await ws.recordChange("delete", () =>
        rmSync(join(dir, "proj.st0", "a.yaml")),
      );
      expect(gone.files).toEqual([{ path: "a.yaml", kind: "removed" }]);
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
