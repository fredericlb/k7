// The one test that stops l8' two halves from drifting apart.
//
// The browser drives transport, this service compiles and sends the song. They address the
// same project only if they spell its session identically — and a mismatch raises nothing
// on either side: the song plays in one session while the frontend steers an empty other,
// which reads as "the engine ignores Play". Nothing else in the repo would catch that.

import { join } from "node:path";
import { SESSIONS, sessionFor } from "@studio/engine-protocol/sessions";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rootDir, slugify } from "./slug.ts";

// A stand-in engine: the prune is about the MAP and the reconnect, so a real socket would only
// add a port to the test. Each instance records what was done to it.
const built: FakeClient[] = [];
class FakeClient {
  closed = false;
  connects = 0;
  droppedSession: string | null = null;
  handlers = new Map<string, (...a: unknown[]) => void>();
  constructor(
    readonly url: string,
    readonly session: string,
  ) {
    built.push(this);
  }
  on(event: string, fn: (...a: unknown[]) => void) {
    this.handlers.set(event, fn);
  }
  connect() {
    this.connects++;
  }
  close() {
    this.closed = true;
    this.handlers.get("close")?.(); // the real client fires this, and it is what re-dials
  }
  dropSession(session: string) {
    this.droppedSession = session;
  }
  setAudioDevice() {}
}
vi.mock("@studio/engine-client/engineClient", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  EngineClient: FakeClient,
}));

const { awaitArm, ensureEngine, pruneIdleLinks, sessionOf, setSelectedEngine } =
  await import("./engineLink.ts");

const wsFor = (email: string, name = "songs") => ({
  root: join(rootDir(), slugify(email), name),
});

describe("sessionOf", () => {
  // THE agreement. This side reads the owner slug out of the workspace path; the browser
  // slugs the logged-in email. Both must land on the same string.
  it("matches what the browser half computes from the same email", () => {
    for (const email of [
      "fred@parapluie.org",
      "a.b+c@example.co.uk",
      "UPPER@Example.COM",
    ])
      expect(sessionOf(wsFor(email))).toBe(sessionFor(SESSIONS.l8, email));
  });

  it("separates two people, and joins one person's workspaces", () => {
    expect(sessionOf(wsFor("a@x.org"))).not.toBe(sessionOf(wsFor("b@x.org")));
    // Same person, two workspaces: ONE session. A person drives one project at a time, and
    // splitting per workspace would leave a stopped project loaded in the engine forever.
    expect(sessionOf(wsFor("a@x.org", "one"))).toBe(
      sessionOf(wsFor("a@x.org", "two")),
    );
  });

  // A bare folder opened directly (rootIsProject) has no owner in its path. One machine,
  // one person — the case that shape exists for — so the bare service id is right.
  it("falls back to the bare service id outside the users root", () => {
    expect(sessionOf({ root: join("/tmp", "some-song") })).toBe(SESSIONS.l8);
    expect(sessionOf(null)).toBe(SESSIONS.l8);
  });
});

// One file service can serve several people, and until this existed `links` only ever grew: an
// abandoned socket re-dialled once a second for the life of the process, and held its session
// open on the engine with it.
describe("pruneIdleLinks", () => {
  const ws = (email: string) => wsFor(email) as never;
  // The client ensureEngine just built. Throws rather than asserting non-null, so a test that
  // silently built nothing fails here instead of three lines later.
  const last = (): FakeClient => {
    const c = built.at(-1);
    if (!c) throw new Error("no engine client was built");
    return c;
  };

  beforeEach(() => {
    built.length = 0;
    // A different url each time, so setSelectedEngine really clears the map rather than no-opping.
    setSelectedEngine(`ws://127.0.0.1:${1000 + built.length}/${Math.random()}`);
  });

  it("drops a link nothing has touched, and it does not re-dial", () => {
    ensureEngine(ws("gone@x.org"));
    const client = last();
    expect(client.connects).toBe(1);

    const later = Date.now() + 10 * 60_000;
    expect(pruneIdleLinks(later)).toEqual([sessionOf(wsFor("gone@x.org"))]);
    expect(client.closed).toBe(true);
    // THE point of deleting from the map before closing: the close handler re-dials unless the
    // map has already let go, so a second connect here would be the reconnect loop coming back.
    expect(client.connects).toBe(1);
  });

  it("never drops the workspace being played", () => {
    // currentWs is null in this process, so sessionOf(null) — the bare service id — is "current".
    ensureEngine(null);
    const client = last();
    expect(pruneIdleLinks(Date.now() + 10 * 60_000)).toEqual([]);
    expect(client.closed).toBe(false);
  });

  it("keeps a link that was used recently", () => {
    ensureEngine(ws("busy@x.org"));
    expect(pruneIdleLinks(Date.now())).toEqual([]);
    expect(last().closed).toBe(false);
  });

  it("reuses one socket per session rather than opening a second", () => {
    const a = ensureEngine(ws("same@x.org"));
    const b = ensureEngine(ws("same@x.org"));
    expect(a).toBe(b);
    expect(built).toHaveLength(1);
  });
});

// Waiting for the engine's answer to an arm. `armed` is BROADCAST to every client in the
// session, so the wait has to pick out its own answer — and it has to let go of its listeners
// whichever way it ends.
describe("awaitArm", () => {
  // An emitter that records what is still attached: the leak is the point of half these tests.
  class ArmSpy {
    sent: string[] = [];
    listeners = new Map<string, Set<(...a: never[]) => void>>();
    on(event: string, fn: (...a: never[]) => void) {
      (
        this.listeners.get(event) ??
        this.listeners.set(event, new Set()).get(event)
      )?.add(fn);
    }
    off(event: string, fn: (...a: never[]) => void) {
      this.listeners.get(event)?.delete(fn);
    }
    arm(track: string) {
      this.sent.push(track);
    }
    emit(event: string, arg: unknown) {
      for (const fn of [...(this.listeners.get(event) ?? [])])
        (fn as (a: unknown) => void)(arg);
    }
    /** Listeners still attached — must be none once the wait is over. */
    attached() {
      let n = 0;
      for (const s of this.listeners.values()) n += s.size;
      return n;
    }
  }
  const spy = () =>
    new ArmSpy() as unknown as ArmSpy & Parameters<typeof awaitArm>[0];

  it("sends the arm and resolves with what the engine answered", async () => {
    const c = spy();
    const out: string[] = [];
    const p = awaitArm(c, "gtr", out, () => true);
    expect(c.sent).toEqual(["gtr"]);
    c.emit("armed", { track: "gtr", armed: true });
    expect(await p).toBe(true);
    expect(out).toEqual([]);
    expect(c.attached()).toBe(0);
  });

  it("IGNORES the answer to another track's arm", async () => {
    // The engine broadcasts every arm in the session. Taking a frame for `bass` as the answer
    // for `gtr` reported the wrong state AND left the real answer with nobody waiting for it.
    const c = spy();
    const out: string[] = [];
    const p = awaitArm(c, "gtr", out, () => true, 50);
    c.emit("armed", { track: "bass", armed: true });
    c.emit("armed", { track: "gtr", armed: false });
    expect(await p).toBe(false);
    expect(out).toEqual([]);
  });

  it("surfaces the engine's refusal and stops waiting", async () => {
    const c = spy();
    const out: string[] = [];
    const p = awaitArm(c, "gtr", out, () => true);
    c.emit("engineError", 'track "gtr" has no input — nothing to record');
    expect(await p).toBeUndefined();
    expect(out).toEqual(['track "gtr" has no input — nothing to record']);
    expect(c.attached()).toBe(0);
  });

  it("names the track and says the link was UP when nothing answered", async () => {
    const c = spy();
    const out: string[] = [];
    expect(await awaitArm(c, "gtr", out, () => true, 5)).toBeUndefined();
    expect(out[0]).toContain('"gtr"');
    expect(out[0]).toContain("[rec]"); // where to look next, rather than a dead end
  });

  it("says the LINK DROPPED when it is no longer up", async () => {
    // The same silence, a different fault: worth telling apart before anyone reads engine logs.
    const c = spy();
    const out: string[] = [];
    expect(await awaitArm(c, "gtr", out, () => false, 5)).toBeUndefined();
    expect(out[0]).toContain("dropped");
  });

  it("lets go of its listeners on a timeout, so the next error is not swallowed", async () => {
    // They were `once`, which never fires when nothing arrives: the stale engineError listener
    // outlived the request and ate the following command's message.
    const c = spy();
    const out: string[] = [];
    await awaitArm(c, "gtr", out, () => true, 5);
    expect(c.attached()).toBe(0);
    c.emit("engineError", "a later, unrelated failure");
    expect(out).toHaveLength(1); // still just the timeout line
  });
});
