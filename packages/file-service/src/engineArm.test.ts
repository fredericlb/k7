// engineArm.test.ts — the arm's two waits: the link opening, then the engine's answer on a broadcast channel.
import { describe, expect, it } from "vitest";
import { armOnceOpen, awaitArm, awaitLinkOpen } from "./engineArm.ts";

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
  stated: (boolean | undefined)[] = [];
  arm(track: string, armed?: boolean) {
    this.sent.push(track);
    this.stated.push(armed);
  }
  emit(event: string, arg?: unknown) {
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

// `armed` is BROADCAST, so the wait picks out its own answer and lets go — docs/activeProject.md.
describe("awaitArm", () => {
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

  it("passes a stated arm on, and leaves a bare one a toggle", async () => {
    const c = spy();
    const out: string[] = [];
    const on = awaitArm(c, "gtr", out, () => true, 1000, true);
    c.emit("armed", { track: "gtr", armed: true });
    await on;
    const toggle = awaitArm(c, "gtr", out, () => true);
    c.emit("armed", { track: "gtr", armed: false });
    await toggle;
    expect(c.stated).toEqual([true, undefined]);
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

describe("awaitLinkOpen", () => {
  it("answers at once for a link already open, listening to nothing", async () => {
    const c = spy();
    expect(await awaitLinkOpen(c, () => true, 1000)).toBe(true);
    expect(c.attached()).toBe(0);
  });

  it("waits for the open of a link still dialling", async () => {
    const c = spy();
    const p = awaitLinkOpen(c, () => false, 1000);
    c.emit("open");
    expect(await p).toBe(true);
    expect(c.attached()).toBe(0);
  });

  it("gives up after its timeout and lets go of its listener", async () => {
    const c = spy();
    expect(await awaitLinkOpen(c, () => false, 5)).toBe(false);
    expect(c.attached()).toBe(0);
  });
});

// The desktop re-dials the session's link on every tab switch, and the editor is drawn before it opens.
describe("armOnceOpen", () => {
  it("holds the arm until the link opens, then sends it", async () => {
    const c = spy();
    const out: string[] = [];
    let open = false;
    const p = armOnceOpen(c, "vox", out, () => open, true, 1000);
    expect(c.sent).toEqual([]); // nothing goes out on a link still dialling
    open = true;
    c.emit("open");
    await new Promise((r) => setTimeout(r, 0));
    expect(c.sent).toEqual(["vox"]);
    c.emit("armed", { track: "vox", armed: true });
    expect(await p).toBe(true);
    expect(out).toEqual([]);
    expect(c.attached()).toBe(0);
  });

  it("says the link is still OPENING, not that the engine is offline, when it never opens", async () => {
    const c = spy();
    const out: string[] = [];
    expect(await armOnceOpen(c, "vox", out, () => false, true, 5)).toBe(
      undefined,
    );
    expect(c.sent).toEqual([]);
    expect(out[0]).toContain("still opening");
    expect(out[0]).toContain('"vox"');
    expect(c.attached()).toBe(0);
  });
});
