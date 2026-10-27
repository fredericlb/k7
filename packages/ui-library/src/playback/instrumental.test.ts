// A library song's instrumental as the bar's button follows it: declared or cut, made on request with
// its percent, and switched to ONCE when the cut asked for here lands — never for one found running.

import type { MediatekEntry } from "@studio/mediatek/types";
import type { SeparateJob, StemsReply } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import {
  declaredInstrumental,
  type InstrumentalClient,
  InstrumentalStore,
  masterOf,
} from "./instrumental";

const song = (extra: Partial<MediatekEntry> = {}): MediatekEntry =>
  ({
    family: "songs",
    id: "songs/A/B/T",
    name: "T",
    path: "songs/A/B/T",
    kind: "song",
    mtime: 0,
    meta: { master: "original.flac" },
    ...extra,
  }) as MediatekEntry;

const job = (patch: Partial<SeparateJob>): SeparateJob =>
  ({
    id: "j1",
    source: "",
    done: false,
    failed: false,
    error: null,
    phase: "separating",
    percent: null,
    lines: [],
    files: [],
    ...patch,
  }) as SeparateJob;

/** A store over a scripted server, its poll driven by hand. */
function harness(script: {
  held?: StemsReply[];
  make?: StemsReply | Error;
  jobs?: (SeparateJob | null)[];
}) {
  const held = [...(script.held ?? [])];
  const jobs = [...(script.jobs ?? [])];
  const recorded: string[] = [];
  const client: InstrumentalClient = {
    held: async () => held.shift() ?? { ready: false, job: null },
    make: async () => {
      if (script.make instanceof Error) throw script.make;
      return script.make ?? { ready: false, job: job({}) };
    },
    job: async () =>
      jobs.length ? (jobs.shift() as SeparateJob | null) : null,
    recorded: async (_e, path) => recorded.push(path),
    isNoEngine: (e) => (e as Error).message === "no engine",
  };
  let tick: (() => unknown) | null = null;
  let stopped = false;
  const store = new InstrumentalStore(client, (fn) => {
    tick = fn;
    stopped = false;
    return () => {
      stopped = true;
    };
  });
  return {
    store,
    recorded,
    tick: async () => {
      await tick?.();
    },
    stopped: () => stopped,
  };
}

const MASTER = "songs/A/B/T/original.flac";
const CUT = "songs/A/B/T/stems/instrumental.wav";

describe("what the button reads off the song", () => {
  it("is the master of a library song, and nothing for a song without one", () => {
    expect(masterOf(song())).toBe(MASTER);
    expect(masterOf(song({ meta: {} }))).toBeNull();
    expect(masterOf(song({ family: "samples" }))).toBeNull();
  });

  it("prefers an instrumental the song declares, when its file is there", () => {
    const declared = song({
      variants: [{ name: "Instrumental", ref: "inst.flac", kind: "file" }],
    });
    expect(declaredInstrumental(declared)).toBe("songs/A/B/T/inst.flac");
    const missing = song({
      variants: [{ name: "instrumental", ref: "x.flac", kind: "missing" }],
    });
    expect(declaredInstrumental(missing)).toBeNull();
  });
});

describe("InstrumentalStore", () => {
  it("finds a cut already made, without asking for one", async () => {
    const h = harness({ held: [{ ready: true, job: null }] });
    await h.store.check(song());
    expect(h.store.get(MASTER)).toEqual({ kind: "ready", path: CUT });
    expect(h.store.takeLanded(MASTER)).toBe(false);
  });

  it("follows a cut found running after a reload, and does not switch to it", async () => {
    const h = harness({
      held: [{ ready: false, job: job({ percent: 10 }) }],
      jobs: [job({ percent: 55 }), job({ done: true, percent: 100 })],
    });
    await h.store.check(song());
    expect(h.store.get(MASTER)).toEqual({ kind: "making", percent: 10 });
    await h.tick();
    expect(h.store.get(MASTER)).toEqual({ kind: "making", percent: 55 });
    await h.tick();
    expect(h.store.get(MASTER)).toEqual({ kind: "ready", path: CUT });
    expect(h.stopped()).toBe(true);
    // Nobody asked for it here: the song playing is left as it is.
    expect(h.store.takeLanded(MASTER)).toBe(false);
  });

  it("makes one on request, its percent shown, and switches to it once when it lands", async () => {
    const h = harness({
      make: { ready: false, job: job({ percent: 0 }) },
      jobs: [job({ percent: 40 }), job({ done: true, percent: 100 })],
    });
    await h.store.make(song({ meta: { master: "original.flac", uuid: "u1" } }));
    expect(h.store.get(MASTER)).toEqual({ kind: "making", percent: 0 });
    await h.tick();
    expect(h.store.get(MASTER)).toEqual({ kind: "making", percent: 40 });
    await h.tick();
    expect(h.store.get(MASTER)).toEqual({ kind: "ready", path: CUT });
    expect(h.store.takeLanded(MASTER)).toBe(true);
    expect(h.store.takeLanded(MASTER)).toBe(false);
    expect(h.recorded).toEqual([CUT]);
  });

  it("says so when no engine is there to cut it", async () => {
    const h = harness({ make: new Error("no engine") });
    await h.store.make(song());
    expect(h.store.get(MASTER)).toMatchObject({
      kind: "failed",
      noEngine: true,
    });
  });

  it("fails a cut forgotten by the server whose file never arrived", async () => {
    const h = harness({
      make: { ready: false, job: job({}) },
      jobs: [null],
      held: [{ ready: false, job: null }],
    });
    await h.store.make(song());
    await h.tick();
    expect(h.store.get(MASTER)).toMatchObject({ kind: "failed" });
    expect(h.store.takeLanded(MASTER)).toBe(false);
  });
});
