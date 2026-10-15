import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToSandbox } from "./widgetRuntime";
import {
  type SandboxFrame,
  type SandboxHost,
  WidgetSandbox,
} from "./widgetSandbox";

// A host whose frames record what the page posts; the test plays the sandbox's side.
function fakeHost() {
  const frames: { win: object; posted: ToSandbox[]; destroyed: boolean }[] = [];
  let on: ((source: unknown, data: unknown) => void) | null = null;
  const host: SandboxHost = {
    createFrame(): SandboxFrame {
      const f = { win: {}, posted: [] as ToSandbox[], destroyed: false };
      frames.push(f);
      return {
        post: (m) => f.posted.push(m),
        isSource: (s) => s === f.win,
        destroy: () => {
          f.destroyed = true;
        },
      };
    },
    listen(fn) {
      on = fn;
      return () => {
        on = null;
      };
    },
  };
  const fromWindow = (win: unknown, data: unknown) => on?.(win, data);
  const from = (i: number, data: unknown) => fromWindow(frames[i].win, data);
  const reqs = (i: number) =>
    frames[i].posted.filter((m) => "req" in m) as (ToSandbox & {
      req: number;
    })[];
  return { host, frames, from, fromWindow, reqs };
}

describe("the widget sandbox, page side", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds every message until the frame says it is ready, then sends them in order", () => {
    const h = fakeHost();
    const sb = new WidgetSandbox(h.host, 1000);
    sb.info("return {};");
    expect(h.frames).toHaveLength(1);
    expect(h.frames[0].posted).toEqual([]);
    h.from(0, { t: "ready" });
    expect(h.frames[0].posted.map((m) => m.t)).toEqual(["script", "describe"]);
  });

  it("matches each reply to its request, whatever order they come back in", async () => {
    const h = fakeHost();
    const sb = new WidgetSandbox(h.host, 1000);
    const a = sb.hidden("x", { params: { a: 1 } });
    const b = sb.hidden("x", { params: { a: 2 } });
    h.from(0, { t: "ready" });
    const [ra, rb] = h.reqs(0).slice(-2);
    h.from(0, { t: "reply", req: rb.req, hidden: ["k2"] });
    h.from(0, { t: "reply", req: ra.req, hidden: [] });
    expect([...((await b) ?? [])]).toEqual(["k2"]);
    expect([...((await a) ?? [])]).toEqual([]);
  });

  it("drops a message that does not come from its own frame", async () => {
    const h = fakeHost();
    const sb = new WidgetSandbox(h.host, 1000);
    const p = sb.info("x");
    h.from(0, { t: "ready" });
    const req = h.reqs(0)[0].req;
    const info = { draws: ["evil"], pointers: [], hasVisible: false };
    const settled = vi.fn();
    p.then(settled);
    // Another window, posting a perfect reply: ignored.
    h.fromWindow({}, { t: "reply", req, info });
    h.fromWindow(null, { t: "reply", req, info });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    h.from(0, {
      t: "reply",
      req,
      info: { draws: ["s"], pointers: [], hasVisible: false },
    });
    expect((await p)?.draws).toEqual(["s"]);
  });

  it("shows nothing hidden before the answer, and answers from its cache after", async () => {
    const h = fakeHost();
    const sb = new WidgetSandbox(h.host, 1000);
    const panel = { params: { a: 1 }, assets: {} };
    const key = sb.visibleKey("x", panel);
    expect(sb.peekHidden(key)).toBeUndefined();
    const p = sb.hidden("x", panel);
    h.from(0, { t: "ready" });
    expect(sb.peekHidden(key)).toBeUndefined();
    const { req } = h.reqs(0)[0];
    h.from(0, { t: "reply", req, hidden: ["k1"] });
    await p;
    expect([...(sb.peekHidden(key) ?? [])]).toEqual(["k1"]);
    const sent = h.frames[0].posted.length;
    await sb.hidden("x", panel);
    expect(h.frames[0].posted.length).toBe(sent);
  });

  it("rebuilds the frame when a script hangs, and never runs that script again", async () => {
    const h = fakeHost();
    const sb = new WidgetSandbox(h.host, 1000);
    const rebuilt = vi.fn();
    sb.subscribe(rebuilt);
    const hung = sb.draw(1, "while (true) {}", "s", {} as never);
    const other = sb.info("return { s() {} };");
    h.from(0, { t: "ready" });
    vi.advanceTimersByTime(1000);
    await vi.runOnlyPendingTimersAsync();
    expect(h.frames[0].destroyed).toBe(true);
    expect(sb.generation).toBe(1);
    expect(rebuilt).toHaveBeenCalledOnce();
    expect((await hung).error).toMatch(/did not answer/);
    // The innocent request is cut short, to be asked again, not blamed.
    expect(await other).toBeNull();
    expect(sb.peekInfo("while (true) {}")?.error).toMatch(/did not answer/);
    const again = await sb.draw(1, "while (true) {}", "s", {} as never);
    expect(again.error).toMatch(/did not answer/);
    // …and asking about another script boots a fresh frame.
    sb.info("return {};");
    expect(h.frames).toHaveLength(2);
  });

  it("ignores a late reply from the frame it threw away", async () => {
    const h = fakeHost();
    const sb = new WidgetSandbox(h.host, 1000);
    sb.info("loop");
    h.from(0, { t: "ready" });
    const { req } = h.reqs(0)[0];
    vi.advanceTimersByTime(1000);
    await vi.runOnlyPendingTimersAsync();
    const p = sb.info("fine");
    h.from(1, { t: "ready" });
    h.from(0, {
      t: "reply",
      req: req + 1,
      info: { draws: ["evil"], pointers: [], hasVisible: false },
    });
    const fresh = h.reqs(1)[0];
    h.from(1, {
      t: "reply",
      req: fresh.req,
      info: { draws: ["s"], pointers: [], hasVisible: false },
    });
    expect((await p)?.draws).toEqual(["s"]);
  });

  it("gives up without a rebuild loop when the frame never boots", async () => {
    const h = fakeHost();
    const sb = new WidgetSandbox(h.host, 1000);
    const p = sb.hidden("x", {});
    vi.advanceTimersByTime(1000);
    await vi.runOnlyPendingTimersAsync();
    expect([...((await p) ?? ["?"])]).toEqual([]);
    expect((await sb.info("x"))?.error).toMatch(/did not start/);
    expect(sb.attach()).toBeNull();
    expect(h.frames).toHaveLength(1);
  });

  it("answers a request whose message cannot be cloned instead of leaving it pending", async () => {
    const frames: object[] = [];
    const ear: { on?: (s: unknown, d: unknown) => void } = {};
    const sb = new WidgetSandbox(
      {
        createFrame: () => {
          const win = {};
          frames.push(win);
          return {
            post: (m) => {
              if (m.t === "visible") throw new Error("DataCloneError");
            },
            isSource: (s) => s === win,
            destroy: () => {},
          };
        },
        listen: (fn) => {
          ear.on = fn;
          return () => {};
        },
      },
      1000,
    );
    const p = sb.hidden("x", { f: () => 1 });
    ear.on?.(frames[0], { t: "ready" });
    expect(await p).toBeNull();
  });
});
