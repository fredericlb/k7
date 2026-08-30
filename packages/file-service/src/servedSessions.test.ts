// One file service, several sessions — so every path asks "what is THIS session serving?"
// rather than "what is the CURRENT workspace?". The difference only shows with two of them, or
// with none: a global set solely by /open is null after a restart and names somebody else's
// project the rest of the time, and both mistakes are silent. See docs/activeProject.md.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc } from "@studio/engine-protocol/build";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rootDir, slugify } from "./slug.ts";

/** A stand-in engine: one per session, recording what it was sent and firing what it is told to. */
const built: FakeClient[] = [];
class FakeClient {
  sent: ProjectDoc[] = [];
  listeners = new Map<string, Set<(a?: unknown) => void>>();
  constructor(
    readonly url: string,
    readonly session: string,
  ) {
    built.push(this);
  }
  on(event: string, fn: (a?: unknown) => void) {
    (
      this.listeners.get(event) ??
      this.listeners.set(event, new Set()).get(event)
    )?.add(fn);
  }
  off(event: string, fn: (a?: unknown) => void) {
    this.listeners.get(event)?.delete(fn);
  }
  emit(event: string, arg?: unknown) {
    for (const fn of [...(this.listeners.get(event) ?? [])]) fn(arg);
  }
  connect() {
    this.emit("open"); // what re-sends on a fresh socket
  }
  close() {
    this.emit("close");
  }
  sendProject(doc: ProjectDoc) {
    this.sent.push(doc);
  }
  flush() {}
  dropSession() {}
  setAudioDevice() {}
  transport() {}
}
vi.mock("@studio/engine-client/engineClient", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  EngineClient: FakeClient,
}));

/** The real one writes yaml and refuses a missing wav; what is under test is which project it is handed. */
const addTakeToTrack = vi.fn(() => "take-1");
vi.mock("@studio/take-render/recordTake", () => ({
  addTakeToTrack: (...a: unknown[]) => addTakeToTrack(...(a as [])),
}));

const {
  ensureEngine,
  noteOwner,
  sessionOf,
  setSelectedEngine,
  startEngineForActive,
  takeJustRecorded,
  unloadEngine,
} = await import("./engineLink.ts");

const dirs: string[] = [];
/**
 * Two sessions still coexist in this process, and they are no longer two PEOPLE: one machine
 * holds one person's workspaces now (docs/activeProject.md). What is left is the owner's
 * session and the BARE one — a folder opened from outside the workspaces root, which is what
 * a preview and the engine queries run in. `inRoot` chooses which.
 */
const wsFor = (inRoot: boolean, name: string) => {
  const project = mkdtempSync(join(tmpdir(), "td-served-"));
  dirs.push(project);
  return {
    root: inRoot ? join(rootDir(), "songs") : join(tmpdir(), "elsewhere", name),
    activeProjectPath: () => project,
    cachedProjectDoc: () => emptyDoc({ name }),
    invalidateProjectDoc: () => {},
    // biome-ignore lint/suspicious/noExplicitAny: a Workspace stand-in — the link reads these four
  } as any;
};

/** The client dialled for `ws`' session. One socket per session, so there is exactly one. */
const clientFor = (ws: { root: string }): FakeClient => {
  const c = built.find((x) => x.session === sessionOf(ws));
  if (!c) throw new Error(`no client for ${sessionOf(ws)}`);
  return c;
};
const namesSent = (ws: { root: string }) =>
  clientFor(ws).sent.map((d) => d.name);

beforeEach(() => {
  noteOwner("someone@example.test"); // or the owner's session IS the bare one
  built.length = 0;
  addTakeToTrack.mockClear();
  // A fresh url each time, so setSelectedEngine really clears the link map rather than no-opping.
  setSelectedEngine(`ws://127.0.0.1:3000/${Math.random()}`);
});
afterEach(async () => {
  // Both sessions, so no test leaves the next one a project it did not serve.
  for (const root of [
    join(rootDir(), "songs"),
    join(tmpdir(), "elsewhere", "x"),
  ])
    await unloadEngine({ root } as never);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("a socket coming back", () => {
  it("re-sends what ITS OWN session was serving, not the last workspace to open one", async () => {
    // The stranding: with one global pair, the reconnecting socket found a note naming the
    // OTHER session and declined to re-send.
    vi.useFakeTimers();
    try {
      const mine = wsFor(true, "my-song");
      const bare = wsFor(false, "bare-song");
      startEngineForActive(mine);
      startEngineForActive(bare); // mine is no longer "current" — and never was the point
      // A baseline rather than a count: dialling sends once into the outbox and once from `open`.
      const n = clientFor(mine).sent.length;
      const m = clientFor(bare).sent.length;

      clientFor(mine).close(); // the engine went away under it
      await vi.advanceTimersByTimeAsync(1100); // the re-dial, whose `open` restores the project
      expect(namesSent(mine).slice(n)).toEqual(["my-song"]);
      expect(namesSent(bare).slice(m)).toEqual([]); // and the other one was not touched
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores nothing for a session that was serving nothing", () => {
    // A link dialled for a preview alone, which is all there is before the first /open.
    const mine = wsFor(true, "my-song");
    ensureEngine(mine);
    clientFor(mine).connect();
    expect(namesSent(mine)).toEqual([]);
  });
});

describe("a take the engine reports", () => {
  it("lands in the project the RECORDING session is serving", () => {
    // Through a global, a take is dropped after a restart and goes to the wrong song.
    const mine = wsFor(true, "my-song");
    const bare = wsFor(false, "bare-song");
    startEngineForActive(mine);
    startEngineForActive(bare);

    const take = {
      track: "gtr",
      file: "C:/takes/gtr.wav",
      start: 0,
      length: 2,
    };
    clientFor(mine).emit("recorded", take);

    expect(addTakeToTrack).toHaveBeenCalledTimes(1);
    const [dir, doc] = addTakeToTrack.mock.calls[0] as unknown as [
      string,
      ProjectDoc,
    ];
    expect(dir).toBe(mine.activeProjectPath()); // ours, though the other opened last
    expect(doc.name).toBe("my-song");
    // Offered back to OUR poll only: one shared `lastTake` handed the clip to whoever asked next.
    expect(takeJustRecorded(mine)).toEqual({ clip: "take-1", track: "gtr" });
    expect(takeJustRecorded(bare)).toBeNull();
  });

  it("says so, loudly, when its session is serving no project", () => {
    // The wav is on disk and this line is the only record of where it went; a bare `return` loses it.
    const mine = wsFor(true, "my-song");
    ensureEngine(mine);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      clientFor(mine).emit("recorded", {
        track: "gtr",
        file: "C:/takes/gtr.wav",
        start: 0,
        length: 2,
      });
      expect(addTakeToTrack).not.toHaveBeenCalled();
      expect(err.mock.calls[0]?.[0]).toContain("C:/takes/gtr.wav");
      expect(err.mock.calls[0]?.[0]).toContain(sessionOf(mine));
    } finally {
      err.mockRestore();
    }
  });
});
