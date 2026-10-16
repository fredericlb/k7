// widgetRuntime.ts — what runs INSIDE the widget sandbox: it compiles each module's `widgets.js`,
// answers `visible` rules, and draws each screen on an OffscreenCanvas of its own, sent back as a bitmap.
// `widgetRuntime` is shipped as its own source text (Function.prototype.toString), so it must stay
// self-contained: no import, no class, no async, nothing a bundler would lower into a helper.
// The page side is widgetSandbox.ts; the rationale is packages/ui-chains-react/docs/lcdScreen.md.

/** A script's shape as the sandbox compiled it — the page never holds the functions themselves. */
export interface ScriptInfo {
  draws: readonly string[];
  pointers: readonly string[];
  hasVisible: boolean;
  error?: string;
}

/** What a draw request carries; the sandbox adds `ctx`, `state` and `sound` to make an LcdFrame. */
export interface DrawData {
  width: number;
  height: number;
  /** Canvas pixels per CSS pixel. */
  scale: number;
  params: Readonly<Record<string, number>>;
  input: readonly number[];
  output: readonly number[];
  color: { ink: string; dim: string; glow: string; bg: string };
  now: number;
  /** Only the slots whose file changed since the last request: the sandbox keeps the rest per screen. */
  sounds?: Readonly<Record<string, Float32Array | null>>;
}

/** The page's requests: `req` numbers the ones that are answered. */
export type ToSandbox =
  | { t: "script"; script: number; source: string }
  | { t: "describe"; req: number; script: number }
  | { t: "visible"; req: number; script: number; panel: unknown }
  | { t: "attach"; screen: number }
  | { t: "detach"; screen: number }
  | {
      t: "draw";
      req: number;
      screen: number;
      script: number;
      id: string;
      frame: DrawData;
    }
  | {
      t: "pointer";
      req: number;
      screen: number;
      script: number;
      id: string;
      frame: DrawData;
      ev: {
        type: "down" | "move" | "up";
        x: number;
        y: number;
        shift: boolean;
        alt: boolean;
      };
    };

/** Every answer: `req` echoes the request, the rest depends on its kind. */
export interface SandboxReply {
  t: "reply";
  req: number;
  info?: ScriptInfo;
  hidden?: string[];
  error?: string;
  asked?: string[];
  took?: boolean;
  sets?: Record<string, number>;
  /** A draw's picture, transferred: the page shows it as is. */
  bitmap?: ImageBitmap;
}

type Post = (msg: SandboxReply, transfer?: Transferable[]) => void;
type MakeCanvas = (w: number, h: number) => OffscreenCanvas;

/** Build the sandbox's message handler; `post` answers the page, `makeCanvas` stands in for OffscreenCanvas in a test. */
export function widgetRuntime(
  post: Post,
  makeCanvas?: MakeCanvas,
): (msg: ToSandbox) => void {
  const make: MakeCanvas | null =
    makeCanvas ??
    (typeof OffscreenCanvas === "function"
      ? (w, h) => new OffscreenCanvas(w, h)
      : null);
  const EXPORT_DEFAULT = /^\s*export\s+default\s+/m;
  const sources = new Map<number, string>();
  const compiled = new Map<number, Compiled>();
  const screens = new Map<number, Screen>();
  type Fn = (...args: unknown[]) => unknown;
  type Compiled = {
    draws: Record<string, Fn>;
    pointers: Record<string, Fn>;
    visible?: Fn;
    error?: string;
  };
  type Screen = {
    canvas: OffscreenCanvas | null;
    ctx: OffscreenCanvasRenderingContext2D | null;
    state: Record<string, unknown>;
    sounds: Map<string, Float32Array | null>;
  };

  const message = (e: unknown): string => {
    const m = e && typeof e === "object" ? (e as Error).message : undefined;
    return typeof m === "string" && m ? m : String(e);
  };

  function compile(source: string): Compiled {
    const out: Compiled = { draws: {}, pointers: {} };
    if (!source.trim()) return out;
    let made: unknown;
    try {
      // The module author's code, compiled here and never in the page — docs/lcdScreen.md.
      made = new Function(
        `"use strict";\n${source.replace(EXPORT_DEFAULT, "return ")}`,
      )();
    } catch (e) {
      out.error = message(e);
      return out;
    }
    if (!made || typeof made !== "object") {
      out.error =
        "widgets.js must return an object: { <widget id>: (lcd) => … }";
      return out;
    }
    for (const id of Object.keys(made)) {
      const f = (made as Record<string, unknown>)[id];
      if (id === "visible") {
        if (typeof f === "function") out.visible = f as Fn;
      } else if (typeof f === "function") out.draws[id] = f as Fn;
      else if (f && typeof f === "object") {
        const pair = f as { draw?: unknown; pointer?: unknown };
        if (typeof pair.draw === "function") out.draws[id] = pair.draw as Fn;
        if (typeof pair.pointer === "function")
          out.pointers[id] = pair.pointer as Fn;
      }
    }
    return out;
  }

  function script(id: number): Compiled {
    let c = compiled.get(id);
    if (!c) {
      c = compile(sources.get(id) ?? "");
      compiled.set(id, c);
    }
    return c;
  }

  // The LcdFrame a draw or a pointer handler sees, without its ctx.
  function frameOf(s: Screen, f: DrawData, asked: Set<string>) {
    if (f.sounds)
      for (const slot of Object.keys(f.sounds))
        s.sounds.set(slot, f.sounds[slot]);
    return {
      width: f.width,
      height: f.height,
      params: f.params,
      input: f.input,
      output: f.output,
      state: s.state,
      color: f.color,
      now: f.now,
      sound(slot: string): Float32Array | null {
        asked.add(slot);
        return s.sounds.get(slot) ?? null;
      },
    };
  }

  function draw(msg: Extract<ToSandbox, { t: "draw" }>): SandboxReply {
    const reply: SandboxReply = { t: "reply", req: msg.req };
    const s = screens.get(msg.screen);
    const fn = s && script(msg.script).draws[msg.id];
    const f = msg.frame;
    const bw = Math.round(f.width * f.scale);
    const bh = Math.round(f.height * f.scale);
    if (!s || !fn || bw < 1 || bh < 1) return reply;
    if (!s.canvas) {
      if (!make) {
        reply.error = "this browser has no OffscreenCanvas to draw a screen on";
        return reply;
      }
      s.canvas = make(bw, bh);
      s.ctx = s.canvas.getContext("2d");
    }
    if (s.canvas.width !== bw) s.canvas.width = bw;
    if (s.canvas.height !== bh) s.canvas.height = bh;
    const ctx = s.ctx;
    if (!ctx) {
      reply.error = "no 2d context";
      return reply;
    }
    // Reset every frame: the script may leave any transform, clip or style behind.
    ctx.setTransform(f.scale, 0, 0, f.scale, 0, 0);
    ctx.clearRect(0, 0, f.width, f.height);
    const asked = new Set<string>();
    const frame = frameOf(s, f, asked) as Record<string, unknown>;
    frame.ctx = ctx;
    ctx.save();
    try {
      fn(frame);
    } catch (e) {
      reply.error = message(e);
    } finally {
      ctx.restore();
    }
    if (asked.size) reply.asked = Array.from(asked);
    reply.bitmap = s.canvas.transferToImageBitmap();
    return reply;
  }

  function pointer(msg: Extract<ToSandbox, { t: "pointer" }>): SandboxReply {
    const reply: SandboxReply = { t: "reply", req: msg.req, took: false };
    const s = screens.get(msg.screen);
    const fn = s && script(msg.script).pointers[msg.id];
    if (!s || !fn) return reply;
    const sets: Record<string, number> = {};
    const frame = frameOf(s, msg.frame, new Set()) as Record<string, unknown>;
    frame.set = (name: unknown, value: unknown) => {
      if (typeof name !== "string") return;
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      sets[name] = value;
    };
    try {
      reply.took = !!fn(frame, msg.ev);
    } catch (e) {
      reply.error = message(e);
    }
    reply.sets = sets;
    return reply;
  }

  function visible(msg: Extract<ToSandbox, { t: "visible" }>): SandboxReply {
    const reply: SandboxReply = { t: "reply", req: msg.req, hidden: [] };
    const rule = script(msg.script).visible;
    if (!rule) return reply;
    let shown: unknown;
    try {
      shown = rule(msg.panel);
    } catch {
      // A rule that throws hides nothing, so a bug never empties a card.
      return reply;
    }
    if (!shown || typeof shown !== "object") return reply;
    const map = shown as Record<string, unknown>;
    reply.hidden = Object.keys(map).filter((id) => map[id] === false);
    return reply;
  }

  return (msg: ToSandbox): void => {
    if (!msg || typeof msg !== "object") return;
    switch (msg.t) {
      case "script":
        sources.set(msg.script, String(msg.source));
        compiled.delete(msg.script);
        return;
      case "describe": {
        const c = script(msg.script);
        const info: ScriptInfo = {
          draws: Object.keys(c.draws),
          pointers: Object.keys(c.pointers),
          hasVisible: !!c.visible,
        };
        if (c.error) info.error = c.error;
        post({ t: "reply", req: msg.req, info });
        return;
      }
      case "visible":
        post(visible(msg));
        return;
      case "attach":
        screens.set(msg.screen, {
          canvas: null,
          ctx: null,
          state: {},
          sounds: new Map(),
        });
        return;
      case "detach":
        screens.delete(msg.screen);
        return;
      case "draw": {
        const r = draw(msg);
        // The picture is TRANSFERRED, never copied: a screen at the ornament rate is many bitmaps.
        post(r, r.bitmap ? [r.bitmap] : undefined);
        return;
      }
      case "pointer":
        post(pointer(msg));
        return;
    }
  };
}
