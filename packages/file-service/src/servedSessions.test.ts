// One file service, several sessions — and every path that used to ask "what is the CURRENT
// workspace?" now asks "what is THIS session serving?". The difference only shows with two of
// them, or with none: a global set solely by /open is null after a restart and names somebody
// else's project the rest of the time, and both mistakes are silent. See docs/activeProject.md.

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
vi.mock("@studio/commands/recordTake", () => ({
  addTakeToTrack: (...a: unknown[]) => addTakeToTrack(...(a as [])),
}));

const {
  ensureEngine,
  sessionOf,
  setSelectedEngine,
  startEngineForActive,
  takeJustRecorded,
  unloadEngine,
} = await import("./engineLink.ts");

const dirs: string[] = [];
/** A workspace OWNED by `email` — that is what puts it in its own session — serving a real folder. */
const wsFor = (email: string, name: string) => {
  const project = mkdtempSync(join(tmpdir(), "td-served-"));
  dirs.push(project);
  return {
    root: join(rootDir(), slugify(email), "songs"),
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
  built.length = 0;
  addTakeToTrack.mockClear();
  // A fresh url each time, so setSelectedEngine really clears the link map rather than no-opping.
  setSelectedEngine(`ws://127.0.0.1:3000/${Math.random()}`);
});
afterEach(async () => {
  // Both sessions, so no test leaves the next one a project it did not serve.
  for (const email of ["ana@x.org", "bo@x.org"])
    await unloadEngine({
      root: join(rootDir(), slugify(email), "songs"),
    } as never);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("a socket coming back", () => {
  it("re-sends what ITS OWN session was serving, not the last workspace to open one", async () => {
    // The stranding. With one global pair, the check on `open` compared the reconnecting socket
    // to whoever opened most recently: Ana's socket came back, found the note naming Bo, declined
    // to re-send, and left her project loaded here and absent from the engine — with nothing to
    // unstick it but an /open of her own.
    vi.useFakeTimers();
    try {
      const ana = wsFor("ana@x.org", "ana-song");
      const bo = wsFor("bo@x.org", "bo-song");
      startEngineForActive(ana);
      startEngineForActive(bo); // Ana is no longer "current" — and never was the point
      // A baseline rather than a count: dialling sends once into the outbox and once more from
      // the socket's own `open`, which is the very mechanism under test here.
      const n = clientFor(ana).sent.length;
      const m = clientFor(bo).sent.length;

      clientFor(ana).close(); // the engine went away under her
      await vi.advanceTimersByTimeAsync(1100); // the re-dial, whose `open` restores the project
      expect(namesSent(ana).slice(n)).toEqual(["ana-song"]);
      expect(namesSent(bo).slice(m)).toEqual([]); // and nobody else's was touched
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores nothing for a session that was serving nothing", () => {
    // A link dialled for a preview alone, which is all there is before the first /open.
    const ana = wsFor("ana@x.org", "ana-song");
    ensureEngine(ana);
    clientFor(ana).connect();
    expect(namesSent(ana)).toEqual([]);
  });
});

describe("a take the engine reports", () => {
  it("lands in the project the RECORDING session is serving", () => {
    // The take used to be addressed through the same global: after a restart it was null and the
    // take was dropped with a console line, and with two people it went to the wrong song.
    const ana = wsFor("ana@x.org", "ana-song");
    const bo = wsFor("bo@x.org", "bo-song");
    startEngineForActive(ana);
    startEngineForActive(bo);

    const take = {
      track: "gtr",
      file: "C:/takes/gtr.wav",
      start: 0,
      length: 2,
    };
    clientFor(ana).emit("recorded", take);

    expect(addTakeToTrack).toHaveBeenCalledTimes(1);
    const [dir, doc] = addTakeToTrack.mock.calls[0] as unknown as [
      string,
      ProjectDoc,
    ];
    expect(dir).toBe(ana.activeProjectPath()); // hers, though Bo opened last
    expect(doc.name).toBe("ana-song");
    // And it is offered back to HER poll only: one shared `lastTake` handed the clip to whoever
    // asked next, which for a shared service is a take appearing in a song it was not made in.
    expect(takeJustRecorded(ana)).toEqual({ clip: "take-1", track: "gtr" });
    expect(takeJustRecorded(bo)).toBeNull();
  });

  it("says so, loudly, when its session is serving no project", () => {
    // The wav is on disk and this line is the only record of where it went. It used to `return`.
    const ana = wsFor("ana@x.org", "ana-song");
    ensureEngine(ana);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      clientFor(ana).emit("recorded", {
        track: "gtr",
        file: "C:/takes/gtr.wav",
        start: 0,
        length: 2,
      });
      expect(addTakeToTrack).not.toHaveBeenCalled();
      expect(err.mock.calls[0]?.[0]).toContain("C:/takes/gtr.wav");
      expect(err.mock.calls[0]?.[0]).toContain(sessionOf(ana));
    } finally {
      err.mockRestore();
    }
  });
});
