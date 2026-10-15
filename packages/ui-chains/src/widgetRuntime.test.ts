import { describe, expect, it } from "vitest";
import {
  type SandboxReply,
  type ToSandbox,
  widgetRuntime,
} from "./widgetRuntime";
import { bootScript } from "./widgetSandbox";

// The runtime as the iframe gets it: its own source text, evaluated with nothing around it.
const fromSource = new Function(
  `return (${widgetRuntime.toString()});`,
)() as typeof widgetRuntime;

// A canvas that records its 2d calls and hands out numbered stand-ins for bitmaps.
function fakeCanvases() {
  const calls: string[] = [];
  const made: { width: number; height: number }[] = [];
  const ctx = new Proxy(
    {},
    {
      get:
        (_t, key) =>
        (...args: unknown[]) =>
          calls.push(`${String(key)}(${args.join(",")})`),
      set: () => true,
    },
  );
  let n = 0;
  const make = (width: number, height: number) => {
    const c = {
      width,
      height,
      getContext: () => ctx,
      transferToImageBitmap: () => ({ n: ++n, w: c.width, h: c.height }),
    };
    made.push(c);
    return c as unknown as OffscreenCanvas;
  };
  return { make, calls, made };
}

function runtime(build = fromSource) {
  const replies: [SandboxReply, Transferable[] | undefined][] = [];
  const canvases = fakeCanvases();
  const handle = build((r, t) => replies.push([r, t]), canvases.make);
  let req = 0;
  let lastTransfer: Transferable[] | undefined;
  const ask = (msg: Record<string, unknown>): SandboxReply => {
    handle({ ...msg, req: ++req } as ToSandbox);
    const [r, t] = replies.pop() ?? [];
    if (!r || r.req !== req) throw new Error("no reply");
    lastTransfer = t;
    return r;
  };
  const load = (source: string, script = 1) => {
    handle({ t: "script", script, source });
    return ask({ t: "describe", script }).info;
  };
  return { handle, ask, load, ...canvases, transfer: () => lastTransfer };
}

const data = (extra: Record<string, unknown> = {}) => ({
  width: 100,
  height: 50,
  scale: 2,
  params: { Gain: 0.5 },
  input: [0.1],
  output: [0.2],
  color: { ink: "a", dim: "b", glow: "c", bg: "d" },
  now: 0,
  ...extra,
});

describe("the sandbox runtime compiles a widgets.js", () => {
  it("takes the draw functions a script RETURNS, by widget id", () => {
    const info = runtime().load("return { screen: (lcd) => lcd, n: 3 };");
    expect(info).toEqual({
      draws: ["screen"],
      pointers: [],
      hasVisible: false,
    });
  });

  it("reads `export default` as the same return", () => {
    const info = runtime().load(
      "const k = 2;\nexport default { a() {}, b: () => k };",
    );
    expect(info?.draws).toEqual(["a", "b"]);
  });

  it("reports a syntax error, a non-object, and nothing for a blank script", () => {
    const rt = runtime();
    expect(rt.load("return { a: ( };", 1)?.error).toBeTruthy();
    expect(rt.load("const a = 1;", 2)?.error).toMatch(/object/);
    expect(rt.load("  \n", 3)).toEqual({
      draws: [],
      pointers: [],
      hasVisible: false,
    });
  });

  it("takes an interactive screen's draw AND its pointer, and `visible` as no screen", () => {
    const info = runtime().load(
      "return { eq: { draw() {}, pointer() { return true; } }, still() {}, visible: () => ({}) };",
    );
    expect(info).toEqual({
      draws: ["eq", "still"],
      pointers: ["eq"],
      hasVisible: true,
    });
  });

  it("runs as its own source text, with nothing of this module around it", () => {
    const rt = runtime(widgetRuntime);
    const viaText = runtime();
    const src = "return { s() {} };";
    expect(viaText.load(src)).toEqual(rt.load(src));
  });

  it("boots from a script that at least parses", () => {
    expect(() => new Function(bootScript())).not.toThrow();
  });
});

describe("a panel's visible rule, in the sandbox", () => {
  const AMP = `export default {
  visible: ({ ampModel }) => {
    if (!ampModel) return {};
    const n = ampModel.knobs;
    return { k1: n >= 1, k2: n >= 2, k3: n >= 3 };
  },
};`;
  const panel = (knobs?: number) => ({
    params: {},
    assets: {},
    ...(knobs === undefined ? {} : { ampModel: { kind: "aida-x", knobs } }),
  });

  it("hides what it answers false for, and only that", () => {
    const rt = runtime();
    rt.load(AMP);
    const hidden = (p: unknown) =>
      rt.ask({ t: "visible", script: 1, panel: p }).hidden;
    expect(hidden(panel(1))).toEqual(["k2", "k3"]);
    expect(hidden(panel(3))).toEqual([]);
    expect(hidden(panel())).toEqual([]);
  });

  it("hides nothing when it throws or has no rule", () => {
    const rt = runtime();
    rt.load("return { visible: () => { throw 1; } };", 1);
    rt.load("return { screen() {} };", 2);
    expect(rt.ask({ t: "visible", script: 1, panel: panel(0) }).hidden).toEqual(
      [],
    );
    expect(rt.ask({ t: "visible", script: 2, panel: panel(0) }).hidden).toEqual(
      [],
    );
  });
});

describe("a screen, drawn in the sandbox", () => {
  const draw = (frame = data()) => ({
    t: "draw",
    screen: 1,
    script: 1,
    id: "s",
    frame,
  });

  it("draws on a canvas of its own at the scale, and TRANSFERS the picture back", () => {
    const rt = runtime();
    rt.load(
      "return { s(lcd) { lcd.ctx.fillText(lcd.params.Gain, lcd.width, lcd.height); } };",
    );
    rt.handle({ t: "attach", screen: 1 });
    const r = rt.ask(draw());
    expect(r.error).toBeUndefined();
    expect(r.bitmap).toEqual({ n: 1, w: 200, h: 100 });
    expect(rt.transfer()).toEqual([r.bitmap]);
    expect(rt.calls).toContain("setTransform(2,0,0,2,0,0)");
    expect(rt.calls).toContain("fillText(0.5,100,50)");
    // A resize keeps the canvas and changes its size.
    expect(rt.ask(draw(data({ width: 60 }))).bitmap).toEqual({
      n: 2,
      w: 120,
      h: 100,
    });
    expect(rt.made).toHaveLength(1);
  });

  it("draws nothing for an unknown id, an empty size, or a detached screen", () => {
    const rt = runtime();
    rt.load("return { s(lcd) { lcd.ctx.fillText('x'); } };");
    rt.handle({ t: "attach", screen: 1 });
    expect(rt.ask({ ...draw(), id: "nope" }).bitmap).toBeUndefined();
    expect(rt.ask(draw(data({ width: 0 }))).bitmap).toBeUndefined();
    rt.handle({ t: "detach", screen: 1 });
    expect(rt.ask(draw()).bitmap).toBeUndefined();
    expect(rt.calls).toEqual([]);
  });

  it("says so where there is no OffscreenCanvas", () => {
    const replies: SandboxReply[] = [];
    const handle = fromSource((r) => replies.push(r));
    handle({ t: "script", script: 1, source: "return { s() {} };" });
    handle({ t: "attach", screen: 1 });
    // Node has none, which is the case under test.
    handle({ ...draw(), req: 1 } as ToSandbox);
    expect(replies[0].error).toMatch(/OffscreenCanvas/);
  });

  it("keeps a screen's state, reports a throw, and says which sounds it asked for", () => {
    const rt = runtime();
    rt.load(`return { s(lcd) {
      lcd.state.n = (lcd.state.n || 0) + 1;
      const t = lcd.sound("table");
      if (lcd.state.n === 2 && !t) throw new Error("no table");
      if (t) lcd.ctx.fillText(t.length + ":" + lcd.state.n);
    } };`);
    rt.handle({ t: "attach", screen: 1 });
    expect(rt.ask(draw()).asked).toEqual(["table"]);
    const threw = rt.ask(draw());
    expect(threw.error).toBe("no table");
    // A draw that threw still sends what it drew, so the page never keeps a stale bitmap.
    expect(threw.bitmap).toBeTruthy();
    rt.ask(draw(data({ sounds: { table: new Float32Array(4) } })));
    // A later frame without the sound still has it: the sandbox keeps what it was sent.
    rt.ask(draw());
    expect(rt.calls).toContain("fillText(4:3)");
    expect(rt.calls).toContain("fillText(4:4)");
  });

  it("collects a pointer handler's finite sets, and whether it took the event", () => {
    const rt = runtime();
    rt.load(`return { eq: { draw() {}, pointer(lcd, ev) {
      lcd.set("Freq", ev.x); lcd.set("Gain", NaN); lcd.set("Freq", ev.x * 2);
      return ev.type === "down";
    } } };`);
    rt.handle({ t: "attach", screen: 1 });
    const ev = { type: "down", x: 10, y: 0, shift: false, alt: false };
    const r = rt.ask({
      t: "pointer",
      screen: 1,
      script: 1,
      id: "eq",
      frame: data(),
      ev,
    });
    expect(r.took).toBe(true);
    expect(r.sets).toEqual({ Freq: 20 });
  });
});
