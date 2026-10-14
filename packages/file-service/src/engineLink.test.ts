// The one test that stops k7' two halves from drifting apart.
//
// The browser drives transport, this service compiles and sends the song. They address the
// same project only if they spell its session identically — and a mismatch raises nothing
// on either side: the song plays in one session while the frontend steers an empty other,
// which reads as "the engine ignores Play". Nothing else in the repo would catch that.

import { mkdtempSync, rmSync, type Stats } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc } from "@studio/engine-protocol/build";
import { SESSIONS, sessionFor } from "@studio/engine-protocol/sessions";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rootDir } from "./slug.ts";

// A stand-in engine, recording what was done to it: the prune is about the MAP and the reconnect.
const built: FakeClient[] = [];
class FakeClient {
  closed = false;
  connects = 0;
  droppedSession: string | null = null;
  previews: [string, number, number][] = [];
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
  preview(file: string, start: number, length: number) {
    this.previews.push([file, start, length]);
  }
  sendProject() {}
  flush() {}
  setAudioDevice() {}
}
vi.mock("@studio/engine-client/engineClient", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  EngineClient: FakeClient,
}));

const {
  awaitArm,
  awaitPluginParams,
  enginePreview,
  ensureEngine,
  outsideTheWatch,
  pruneIdleLinks,
  noteOwner,
  sessionOf,
  setSelectedEngine,
  startEngineForActive,
} = await import("./engineLink.ts");

const wsFor = (_email: string, name = "songs") => ({
  root: join(rootDir(), name),
});

/** `wsFor` with enough of a Workspace to actually SERVE `dir` — which is what `served` records. */
const wsServing = (email: string, dir: string) => ({
  ...wsFor(email),
  activeProjectPath: () => dir,
  cachedProjectDoc: () => emptyDoc({ name: "song" }),
  invalidateProjectDoc: () => {},
});

describe("sessionOf", () => {
  // THE agreement: this side names the owner it was TOLD, the browser slugs the same email.
  // The tree no longer carries it — one root, one person (docs/activeProject.md).
  it("matches what the browser half computes from the same email", () => {
    for (const email of [
      "fred@parapluie.org",
      "a.b+c@example.co.uk",
      "UPPER@Example.COM",
    ]) {
      noteOwner(email);
      expect(sessionOf(wsFor(email))).toBe(sessionFor(SESSIONS.k7, email));
    }
  });

  it("joins one person's workspaces into ONE session", () => {
    noteOwner("a@x.org");
    expect(sessionOf(wsFor("a@x.org", "one"))).toBe(
      sessionOf(wsFor("a@x.org", "two")),
    );
  });

  // The bench runs BESIDE the song, so its workspace is a session of its own — k7's engineSession.test.ts is the other half.
  it("gives the bench's workspace the bench's session, and nothing else", () => {
    noteOwner("a@x.org");
    expect(sessionOf(wsFor("a@x.org", "Banc"))).toBe(
      sessionFor(SESSIONS.bench, "a@x.org"),
    );
    expect(sessionOf(wsFor("a@x.org", "Bancs"))).toBe(
      sessionFor(SESSIONS.k7, "a@x.org"),
    );
  });

  // Nothing served, or a folder outside the root: the bare session, as before.
  it("falls back to the bare service id outside the workspaces root", () => {
    noteOwner("a@x.org");
    expect(sessionOf({ root: join("/tmp", "some-song") })).toBe(SESSIONS.k7);
    expect(sessionOf(null)).toBe(SESSIONS.k7);
  });
});

// Narrowing a watcher fails SILENTLY, so the predicate is tested rather than trusted — docs/activeProject.md.
describe("outsideTheWatch", () => {
  const dir = join("/tmp", "song.k7");
  const file = { isFile: () => true } as Stats;
  const folder = { isFile: () => false } as Stats;

  it("keeps a pattern wherever it sits", () => {
    for (const p of [
      join(dir, "beat.strudel"),
      join(dir, "algo", "beat.strudel"),
      join(dir, "media", "takes", "beat.strudel"),
    ])
      expect(outsideTheWatch(dir, p, file), p).toBe(false);
  });

  it("drops every file that is not one", () => {
    for (const p of [
      join(dir, "project.yaml"),
      join(dir, "media", "take-01.wav"),
      join(dir, "renders", "mix.wav"),
    ])
      expect(outsideTheWatch(dir, p, file), p).toBe(true);
  });

  // The saving is here: a pruned directory is one chokidar never walks.
  it("prunes what the file service does not consider part of a project", () => {
    for (const p of [
      join(dir, ".git"),
      join(dir, "node_modules"),
      join(dir, "_recycle_bin"),
    ])
      expect(outsideTheWatch(dir, p, folder), p).toBe(true);
  });

  it("walks the project's own folders", () => {
    expect(outsideTheWatch(dir, join(dir, "media"), folder)).toBe(false);
    expect(outsideTheWatch(dir, join(dir, "algo"), folder)).toBe(false);
  });

  // chokidar 3 asks once with the path alone, before a file's kind is known.
  it("commits to nothing before it has the stats", () => {
    expect(outsideTheWatch(dir, join(dir, "take-01.wav"))).toBe(false);
    expect(outsideTheWatch(dir, dir)).toBe(false);
  });
});

// Until this existed `links` only ever grew, into a permanent reconnect loop — docs/activeProject.md.
describe("pruneIdleLinks", () => {
  const ws = (email: string) => wsFor(email) as never;
  // The client ensureEngine just built; throws, so a test that built nothing fails here.
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
    // A second connect here would be the reconnect loop coming back — dropLink deletes before it closes.
    expect(client.connects).toBe(1);
  });

  it("never drops a session that is holding a project", () => {
    // The protected set is `served`, not one "current" workspace — see docs/activeProject.md.
    const dir = mkdtempSync(join(tmpdir(), "td-prune-"));
    try {
      // biome-ignore lint/suspicious/noExplicitAny: a Workspace stand-in, see wsServing
      startEngineForActive(wsServing("player@x.org", dir) as any);
      const client = last();
      expect(pruneIdleLinks(Date.now() + 10 * 60_000)).toEqual([]);
      expect(client.closed).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("DOES drop an idle session that is holding nothing", () => {
    // A link dialled for a preview alone: being the bare session is no reason to spare it.
    ensureEngine(null);
    const client = last();
    expect(pruneIdleLinks(Date.now() + 10 * 60_000)).toEqual([SESSIONS.k7]);
    expect(client.closed).toBe(true);
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

/** A preview goes to the REQUEST's workspace session, never a global one — docs/activeProject.md. */
describe("enginePreview", () => {
  beforeEach(() => {
    built.length = 0;
    setSelectedEngine(`ws://127.0.0.1:2000/${Math.random()}`);
  });

  it("plays through the request's workspace session, not the bare default", () => {
    enginePreview(wsFor("fred@parapluie.org") as never, "C:/a.wav", 0, 0.5);
    const client = built.at(-1);
    if (!client) throw new Error("no engine client was built");
    expect(client.session).toBe(sessionOf(wsFor("fred@parapluie.org")));
    expect(client.session).not.toBe(SESSIONS.k7); // the bare id is the silent wrong room
    expect(client.previews).toEqual([["C:/a.wav", 0, 0.5]]);
  });
});

// `armed` is BROADCAST, so the wait picks out its own answer and lets go — docs/activeProject.md.
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
    // A frame for `bass` taken as `gtr`'s answer left the real answer with nobody waiting.
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
    // A `once` never fires on a timeout, so the stale listener eats the next message.
    const c = spy();
    const out: string[] = [];
    await awaitArm(c, "gtr", out, () => true, 5);
    expect(c.attached()).toBe(0);
    c.emit("engineError", "a later, unrelated failure");
    expect(out).toHaveLength(1); // still just the timeout line
  });
});

/** The arm's shape, one notch worse: the reply is engine-GLOBAL and slow — docs/activeProject.md. */
describe("awaitPluginParams", () => {
  class ListSpy {
    asked: [string, string][] = [];
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
    listPluginParams(format: string, id: string) {
      this.asked.push([format, id]);
    }
    emit(event: string, arg: unknown) {
      for (const fn of [...(this.listeners.get(event) ?? [])])
        (fn as (a: unknown) => void)(arg);
    }
    attached() {
      let n = 0;
      for (const s of this.listeners.values()) n += s.size;
      return n;
    }
  }
  const spy = () =>
    new ListSpy() as unknown as ListSpy &
      Parameters<typeof awaitPluginParams>[0];
  const knob = { name: "Cutoff", min: 0, max: 1 };

  it("asks by format AND id, and resolves with the list", async () => {
    const c = spy();
    const p = awaitPluginParams(c, "VST3", "C:/vst/Serum.vst3");
    expect(c.asked).toEqual([["VST3", "C:/vst/Serum.vst3"]]);
    c.emit("pluginParamList", {
      format: "VST3",
      id: "C:/vst/Serum.vst3",
      found: true,
      params: [knob],
    });
    expect(await p).toEqual({ found: true, params: [knob] });
    expect(c.attached()).toBe(0);
  });

  it("reads a frame with no `found` as loaded", async () => {
    // An engine too old to send the flag could only answer by loading something.
    const c = spy();
    const p = awaitPluginParams(c, "VST3", "C:/vst/Serum.vst3");
    c.emit("pluginParamList", {
      format: "VST3",
      id: "C:/vst/Serum.vst3",
      params: [knob],
    });
    expect((await p)?.found).toBe(true);
  });

  it("IGNORES another plugin's list", async () => {
    // Two of these overlap routinely, and the first frame would draw Diva's panel into Serum's ui.yaml.
    const c = spy();
    const p = awaitPluginParams(c, "VST3", "C:/vst/Serum.vst3", 200);
    c.emit("pluginParamList", {
      format: "VST3",
      id: "C:/vst/Diva.vst3",
      found: true,
      params: [{ name: "Wrong", min: 0, max: 1 }],
    });
    c.emit("pluginParamList", {
      format: "VST3",
      id: "C:/vst/Serum.vst3",
      found: true,
      params: [knob],
    });
    expect((await p)?.params).toEqual([knob]);
  });

  /** THREE outcomes, and the MIDDLE one is why the flag exists — see docs/activeProject.md. */
  it("tells silence, an unloadable plugin and an empty list apart", async () => {
    const c = spy();

    const declaresNone = awaitPluginParams(c, "VST3", "C:/vst/Quiet.vst3");
    c.emit("pluginParamList", {
      format: "VST3",
      id: "C:/vst/Quiet.vst3",
      found: true,
      params: [],
    });
    expect(await declaresNone).toEqual({ found: true, params: [] });

    const cannotLoad = awaitPluginParams(c, "VST3", "C:/vst/Broken.vst3");
    c.emit("pluginParamList", {
      format: "VST3",
      id: "C:/vst/Broken.vst3",
      found: false,
      params: [],
    });
    expect(await cannotLoad).toEqual({ found: false, params: [] });

    expect(
      await awaitPluginParams(c, "VST3", "C:/vst/Gone.vst3", 5),
    ).toBeUndefined();
  });

  it("lets go of its listener on a timeout", async () => {
    const c = spy();
    await awaitPluginParams(c, "VST3", "C:/vst/Gone.vst3", 5);
    expect(c.attached()).toBe(0);
  });
});
