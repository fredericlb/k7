// `served` is this process's belief about another process's state, and the two drift
// silently: a session emptied under us raises nothing, and neither does a link that has gone
// inert. What is pinned here is that the poll ASKS the engine rather than trusting the note —
// and what it does with each of the two answers. See docs/activeProject.md.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc } from "@studio/engine-protocol/build";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** One session the engine claims to hold; only `id` and `loaded` are ever read. */
type Held = { id: string; loaded: boolean };

/**
 * A stand-in engine that answers `list-sessions` with whatever the test set.
 *
 * `answer: null` is the case with no other symptom — the engine says NOTHING, which is what a
 * link that is established, `ready` and inert looks like from here.
 */
const built: FakeClient[] = [];
class FakeClient {
  static answer: Held[] | null = [];
  sent: ProjectDoc[] = [];
  asked = 0;
  closed = false;
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
    this.emit("open"); // what makes the link `ready` — and what re-sends on a fresh socket
  }
  close() {
    this.closed = true;
    this.emit("close");
  }
  listSessions() {
    this.asked++;
    if (FakeClient.answer) this.emit("sessions", FakeClient.answer);
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

const {
  RECONCILE_EVERY_MS,
  SESSIONS_TIMEOUT_MS,
  awaitSessions,
  prewarmEngineForActive,
  sessionOf,
  setSelectedEngine,
  startEngineForActive,
  unloadEngine,
} = await import("./engineLink.ts");

let root: string;
const wsWith = (dir: string, name: string) =>
  ({
    root,
    activeProjectPath: () => dir,
    cachedProjectDoc: () => emptyDoc({ name }),
    invalidateProjectDoc: () => {},
    // biome-ignore lint/suspicious/noExplicitAny: a Workspace stand-in — the link reads these four
  }) as any;

/** The live client, i.e. the one the link is using now. */
const live = (): FakeClient => {
  const c = built.at(-1);
  if (!c) throw new Error("no engine client was built");
  return c;
};
const namesSince = (n: number) =>
  live()
    .sent.slice(n)
    .map((d) => d.name);

// The throttle is module state, so every poll in this file must claim a later moment than the last.
let clock = 0;
const later = (): number => (clock += RECONCILE_EVERY_MS * 2);

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "td-reconcile-"));
  built.length = 0;
  FakeClient.answer = [];
  setSelectedEngine(`ws://127.0.0.1:1/${later()}`);
  // Forget the previous test's project, so this session starts serving nothing. `null` is the
  // right workspace to name: a temp dir outside the users root falls back to the bare session,
  // which is the one every case in this file lands on.
  await unloadEngine(null);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("awaitSessions", () => {
  // Widened like awaitArm's spy: the fake takes any event, the parameter type wants one.
  const spy = () =>
    new FakeClient("ws://x", "l8") as unknown as FakeClient &
      Parameters<typeof awaitSessions>[0];

  it("asks, and resolves with what the engine holds", async () => {
    const c = spy();
    FakeClient.answer = [{ id: "l8", loaded: true }];
    expect(await awaitSessions(c, 50)).toEqual([{ id: "l8", loaded: true }]);
    expect(c.asked).toBe(1);
  });

  it("resolves undefined when nothing answers, and lets go of its listener", async () => {
    // `once` would never fire on a timeout and would then eat a later, unrelated answer.
    const c = spy();
    FakeClient.answer = null;
    expect(await awaitSessions(c, 5)).toBeUndefined();
    expect(c.listeners.get("sessions")?.size ?? 0).toBe(0);
  });
});

describe("the poll's engine upkeep", () => {
  it("loads the persisted project when the engine is idle", () => {
    prewarmEngineForActive(wsWith(root, "song"), later());
    expect(namesSince(0)).toContain("song");
  });

  it("sends nothing more while the engine is holding the session", async () => {
    const ws = wsWith(root, "song");
    startEngineForActive(ws);
    FakeClient.answer = [{ id: sessionOf(ws), loaded: true }];
    const n = live().sent.length;
    prewarmEngineForActive(ws, later());
    await vi.waitFor(() => expect(live().asked).toBe(1));
    expect(namesSince(n)).toEqual([]);
  });

  it("re-sends the project when the engine turns out to be holding nothing", async () => {
    // The stranding this exists for: the note says we are serving, the engine says loaded=false,
    // and before this nothing anywhere compared the two.
    const ws = wsWith(root, "song");
    startEngineForActive(ws);
    FakeClient.answer = [];
    const n = live().sent.length;
    prewarmEngineForActive(ws, later());
    await vi.waitFor(() => expect(namesSince(n)).toEqual(["song"]));
  });

  it("re-sends when the engine holds the session but has emptied it", async () => {
    const ws = wsWith(root, "song");
    startEngineForActive(ws);
    FakeClient.answer = [{ id: sessionOf(ws), loaded: false }];
    const n = live().sent.length;
    prewarmEngineForActive(ws, later());
    await vi.waitFor(() => expect(namesSince(n)).toEqual(["song"]));
  });

  it("re-dials a link that does not answer at all", async () => {
    // A re-send cannot land on an inert socket, however many times it is tried — the only cure
    // is a new one, and its `open` carries the project back.
    vi.useFakeTimers();
    try {
      const ws = wsWith(root, "song");
      startEngineForActive(ws);
      const stale = live();
      FakeClient.answer = null;
      prewarmEngineForActive(ws, later());
      await vi.advanceTimersByTimeAsync(SESSIONS_TIMEOUT_MS + 1);
      expect(stale.closed).toBe(true);
      expect(live()).not.toBe(stale);
      expect(live().sent.map((d) => d.name)).toEqual(["song"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a poll for ANOTHER project in the same session alone", async () => {
    // Reconciling it would re-assert the project being left. The session is the unit here —
    // a different session has its own engine edit and its own note, and reconciles on its own.
    const other = mkdtempSync(join(tmpdir(), "td-reconcile-b-"));
    try {
      startEngineForActive(wsWith(root, "song"));
      FakeClient.answer = [];
      const n = live().sent.length;
      prewarmEngineForActive(wsWith(other, "elsewhere"), later());
      await vi.waitFor(() => expect(live().asked).toBe(0));
      expect(namesSince(n)).toEqual([]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("asks at most once per RECONCILE_EVERY_MS, however many tabs poll", async () => {
    const ws = wsWith(root, "song");
    startEngineForActive(ws);
    FakeClient.answer = [{ id: sessionOf(ws), loaded: true }];
    const now = later();
    prewarmEngineForActive(ws, now);
    await vi.waitFor(() => expect(live().asked).toBe(1));
    prewarmEngineForActive(ws, now + 1);
    prewarmEngineForActive(ws, now + RECONCILE_EVERY_MS - 1);
    expect(live().asked).toBe(1);
  });
});
