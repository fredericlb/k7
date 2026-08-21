// The undo/redo journal: ProjectHistory's round-trips (text inline, binary as blobs, ring
// eviction, redo-tail truncation, on-disk persistence) and Workspace.recordChange, which is
// how a real edit reaches it — snapshot the project, run the mutation, diff, push. The render
// itself (the C++ engine) is where a unit test stops, so recordChange is driven directly here.

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
import { ProjectHistory } from "./history.ts";
import { Workspace } from "./workspace.ts";

let dir: string;
const read = (rel: string): string => readFileSync(join(dir, rel), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-history-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("ProjectHistory", () => {
  it("round-trips a text change and reports which file it touched", () => {
    writeFileSync(join(dir, "a.yaml"), "v2");
    const h = new ProjectHistory(dir);
    h.push({
      label: "edit a.yaml",
      changes: [{ path: "a.yaml", before: "v1", after: "v2" }],
      blobs: [],
    });

    const undone = h.undo();
    expect(undone).toEqual({
      kind: "text",
      label: "edit a.yaml",
      files: ["a.yaml"],
    });
    expect(read("a.yaml")).toBe("v1");

    const redone = h.redo();
    expect(redone?.files).toEqual(["a.yaml"]);
    expect(read("a.yaml")).toBe("v2");
  });

  it("undo of a created file deletes it, redo re-creates it", () => {
    writeFileSync(join(dir, "new.yaml"), "hello");
    const h = new ProjectHistory(dir);
    h.push({
      label: "add new.yaml",
      changes: [{ path: "new.yaml", before: null, after: "hello" }],
      blobs: [],
    });
    h.undo();
    expect(existsSync(join(dir, "new.yaml"))).toBe(false);
    h.redo();
    expect(read("new.yaml")).toBe("hello");
  });

  it("round-trips a binary blob and marks the entry a process", () => {
    writeFileSync(join(dir, "r.wav"), Buffer.from("new"));
    const h = new ProjectHistory(dir);
    h.push({
      label: "clip process",
      changes: [],
      blobs: [
        {
          path: "r.wav",
          before: Buffer.from("old"),
          after: Buffer.from("new"),
        },
      ],
    });
    expect(h.peekUndo()?.kind).toBe("process");

    h.undo();
    expect(read("r.wav")).toBe("old");
    h.redo();
    expect(read("r.wav")).toBe("new");
  });

  it("a fresh push truncates the redo tail", () => {
    const h = new ProjectHistory(dir);
    const change = (p: string, after: string) => ({
      label: p,
      changes: [{ path: p, before: null, after }],
      blobs: [],
    });
    h.push(change("a.yaml", "A"));
    h.push(change("b.yaml", "B"));
    h.undo(); // b.yaml undone; cursor sits after a.yaml
    h.push(change("c.yaml", "C")); // forks history — b.yaml's redo is gone
    expect(h.peekRedo()).toBeNull();
    expect(h.peekUndo()?.files).toEqual(["c.yaml"]);
  });

  it("keeps at most 1000 entries, evicting the oldest", () => {
    const h = new ProjectHistory(dir);
    for (let n = 0; n < 1005; n++)
      h.push({
        label: `e${n}`,
        changes: [{ path: `f${n}.yaml`, before: null, after: `${n}` }],
        blobs: [],
      });
    // Read the journal off disk rather than undoing 1000× (each undo is a filesystem write).
    const j = JSON.parse(
      readFileSync(join(dir, "_history", "journal.json"), "utf8"),
    ) as { cursor: number; entries: { label: string }[] };
    expect(j.entries.length).toBe(1000);
    expect(j.cursor).toBe(1000);
    expect(j.entries[0].label).toBe("e5"); // e0..e4 evicted from the front
    expect(j.entries.at(-1)?.label).toBe("e1004");
  });

  it("persists across instances", () => {
    writeFileSync(join(dir, "a.yaml"), "v2");
    new ProjectHistory(dir).push({
      label: "edit a.yaml",
      changes: [{ path: "a.yaml", before: "v1", after: "v2" }],
      blobs: [],
    });
    // A new instance reads the journal off disk and can still undo.
    const reopened = new ProjectHistory(dir);
    expect(reopened.undo()?.files).toEqual(["a.yaml"]);
    expect(read("a.yaml")).toBe("v1");
  });
});

describe("Workspace.recordChange", () => {
  // A workspace whose root holds one `.st0` project, made active.
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

    const undone = ws.undoHistory();
    expect(undone?.files).toEqual(["proj.st0/a.yaml"]);
    expect(read("proj.st0/a.yaml")).toBe("v1");

    ws.redoHistory();
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

    ws.undoHistory();
    expect(read("proj.st0/r.wav")).toBe("old");
  });

  it("records nothing when the mutation changed no files", async () => {
    const { ws } = openProject();
    await ws.recordChange("noop", () => {});
    expect(ws.historyState().canUndo).toBe(false);
  });

  // The same diff, said the other way: what a CLIENT is told so it can scope its reload. The
  // journal's own paths stay workspace-relative; these are the project's own.
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
