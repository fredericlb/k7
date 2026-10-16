// widgetSandbox.ts — the page's half of the widget sandbox: ONE hidden `sandbox="allow-scripts"`
// iframe per page (an opaque origin, no network) whose worker runs every module's `widgets.js`
// and answers a screen's draw with a bitmap, since no canvas of the page ever crosses into it.
// Every call is a request answered over postMessage, so every answer is ASYNC: a caller shows
// its last known answer until the new one lands. A request unanswered in time means a hung
// script: the iframe is thrown away and rebuilt, and that script text is never run again.
// The other half is widgetRuntime.ts; the rationale is packages/ui-chains-react/docs/lcdScreen.md.

import {
  type DrawData,
  type SandboxReply,
  type ScriptInfo,
  type ToSandbox,
  widgetRuntime,
} from "./widgetRuntime";

export type { DrawData, ScriptInfo } from "./widgetRuntime";

/** One sandbox instance as the client drives it: a test hands in a fake. */
export interface SandboxFrame {
  post(msg: ToSandbox): void;
  /** Is this `MessageEvent.source` the frame's own window? Anything else is dropped. */
  isSource(source: unknown): boolean;
  destroy(): void;
}

/** Where frames come from and how the page hears them. */
export interface SandboxHost {
  createFrame(): SandboxFrame;
  listen(on: (source: unknown, data: unknown) => void): () => void;
}

/** A pointer handler's answer: whether it took the event, and the params it set, in order. */
export interface PointerAnswer {
  took: boolean;
  sets: Record<string, number>;
  error?: string;
}

/** A draw's answer: its picture, its error, and the sound slots it asked for. */
export interface DrawAnswer {
  bitmap?: ImageBitmap;
  error?: string;
  asked?: string[];
}

type Pending = {
  resolve: (r: SandboxReply | null) => void;
  timer: ReturnType<typeof setTimeout>;
  source?: string;
};

/** How long a request may wait before its script is declared hung. */
export const SANDBOX_TIMEOUT_MS = 3000;
const CACHE_MAX = 512;
const EMPTY: ReadonlySet<string> = new Set();

export class WidgetSandbox {
  /** Bumped on every rebuild: every screen opened in the old frame must be opened again. */
  generation = 0;
  private frame: SandboxFrame | null = null;
  private ready = false;
  private broken = false;
  private queue: ToSandbox[] = [];
  private pending = new Map<number, Pending>();
  private nextReq = 1;
  private nextScreen = 1;
  private scriptIds = new Map<string, number>();
  private sent = new Set<number>();
  private hung = new Set<string>();
  private infos = new Map<string, ScriptInfo>();
  private hiddens = new Map<string, ReadonlySet<string>>();
  private subs = new Set<() => void>();
  private unlisten: (() => void) | null = null;

  constructor(
    private readonly host: SandboxHost,
    private readonly timeoutMs = SANDBOX_TIMEOUT_MS,
  ) {}

  /** Hear a rebuild. */
  subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };

  getGeneration = (): number => this.generation;

  /** The script's shape if already known: synchronous, for a render. */
  peekInfo(source: string): ScriptInfo | undefined {
    return this.infos.get(source);
  }

  /** The script's shape; null when a rebuild cut the question short, to be asked again. */
  info(source: string): Promise<ScriptInfo | null> {
    const known = this.infos.get(source);
    if (known) return Promise.resolve(known);
    return this.request({ t: "describe", req: 0, script: 0 }, source).then(
      (r) => {
        if (r?.info) {
          this.remember(this.infos, source, r.info);
          return r.info;
        }
        return this.whyNot(source) ? this.failedInfo(source) : null;
      },
    );
  }

  /** The cache key of a `visible` question. */
  visibleKey(source: string, panel: unknown): string {
    return `${this.scriptId(source)}:${JSON.stringify(panel)}`;
  }

  peekHidden(key: string): ReadonlySet<string> | undefined {
    return this.hiddens.get(key);
  }

  /** The ids the `visible` rule hides — none when it throws, hangs or has none; null when a rebuild cut it short. */
  hidden(source: string, panel: unknown): Promise<ReadonlySet<string> | null> {
    const key = this.visibleKey(source, panel);
    const known = this.hiddens.get(key);
    if (known) return Promise.resolve(known);
    return this.request(
      { t: "visible", req: 0, script: 0, panel },
      source,
    ).then((r) => {
      if (!r) return this.whyNot(source) ? EMPTY : null;
      const set = r.hidden?.length ? new Set(r.hidden) : EMPTY;
      this.remember(this.hiddens, key, set);
      return set;
    });
  }

  /** Open a screen: the sandbox keeps its canvas, its `state` and its sounds under the id returned. */
  attach(): number | null {
    if (this.broken) return null;
    const screen = this.nextScreen++;
    this.send({ t: "attach", screen });
    return screen;
  }

  detach(screen: number): void {
    if (this.frame) this.send({ t: "detach", screen });
  }

  /** Draw one frame of screen `id`; the answer carries the picture as a bitmap. */
  draw(
    screen: number,
    source: string,
    id: string,
    frame: DrawData,
  ): Promise<DrawAnswer> {
    return this.request(
      { t: "draw", req: 0, screen, script: 0, id, frame },
      source,
    ).then((r) =>
      r
        ? { error: r.error, asked: r.asked, bitmap: r.bitmap }
        : { error: this.whyNot(source) },
    );
  }

  pointer(
    screen: number,
    source: string,
    id: string,
    frame: DrawData,
    ev: Extract<ToSandbox, { t: "pointer" }>["ev"],
  ): Promise<PointerAnswer> {
    return this.request(
      { t: "pointer", req: 0, screen, script: 0, id, frame, ev },
      source,
    ).then((r) =>
      r
        ? { took: !!r.took, sets: r.sets ?? {}, error: r.error }
        : { took: false, sets: {}, error: this.whyNot(source) },
    );
  }

  // Why a request got no reply, when the reason outlives a rebuild: a hung script, or no sandbox at all.
  private whyNot(source: string): string | undefined {
    return this.broken || this.hung.has(source)
      ? this.failedInfo(source).error
      : undefined;
  }

  private failedInfo(source: string): ScriptInfo {
    const error = this.hung.has(source)
      ? `did not answer within ${this.timeoutMs} ms, and was stopped`
      : "the widget sandbox did not start";
    return { draws: [], pointers: [], hasVisible: false, error };
  }

  private remember<V>(map: Map<string, V>, key: string, value: V): void {
    if (map.size >= CACHE_MAX) map.delete(map.keys().next().value as string);
    map.set(key, value);
  }

  private scriptId(source: string): number {
    let id = this.scriptIds.get(source);
    if (id === undefined) {
      id = this.scriptIds.size + 1;
      this.scriptIds.set(source, id);
    }
    return id;
  }

  // Resolves with the sandbox's reply, or null when the script hung or the frame is gone.
  private request(
    msg: Extract<ToSandbox, { req: number; script: number }>,
    source: string,
  ): Promise<SandboxReply | null> {
    if (this.broken || this.hung.has(source)) return Promise.resolve(null);
    const script = this.scriptId(source);
    if (!this.sent.has(script)) {
      this.sent.add(script);
      this.send({ t: "script", script, source });
    }
    const req = this.nextReq++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.expire(req), this.timeoutMs);
      this.pending.set(req, { resolve, timer, source });
      this.send({ ...msg, req, script } as ToSandbox);
    });
  }

  private send(msg: ToSandbox): void {
    this.ensureFrame();
    if (!this.ready) {
      this.queue.push(msg);
      return;
    }
    this.post(msg);
  }

  private post(msg: ToSandbox): void {
    try {
      this.frame?.post(msg);
    } catch {
      // Something in it cannot be cloned: answer the request as failed rather than leave it hanging.
      if ("req" in msg) this.settle(msg.req, null);
    }
  }

  private ensureFrame(): void {
    if (this.frame) return;
    if (!this.unlisten)
      this.unlisten = this.host.listen((src, data) =>
        this.onMessage(src, data),
      );
    this.ready = false;
    this.frame = this.host.createFrame();
  }

  private onMessage(source: unknown, data: unknown): void {
    if (!this.frame?.isSource(source)) return;
    const d = data as { t?: unknown; req?: unknown } | null;
    if (!d || typeof d !== "object") return;
    if (d.t === "ready") {
      if (this.ready) return;
      this.ready = true;
      const queued = this.queue;
      this.queue = [];
      for (const m of queued) this.post(m);
      return;
    }
    if (d.t === "reply" && typeof d.req === "number")
      this.settle(d.req, d as SandboxReply);
  }

  private settle(req: number, reply: SandboxReply | null): void {
    const p = this.pending.get(req);
    if (!p) {
      reply?.bitmap?.close?.();
      return;
    }
    this.pending.delete(req);
    clearTimeout(p.timer);
    p.resolve(reply);
  }

  // One more turn of the event loop first, so a reply already queued behind a busy page still wins.
  private expire(req: number): void {
    setTimeout(() => {
      const p = this.pending.get(req);
      if (!p) return;
      if (!this.ready) {
        // The frame never booted: no script is to blame, and no rebuild would do better.
        this.broken = true;
      } else if (p.source !== undefined) {
        this.hung.add(p.source);
        this.infos.set(p.source, this.failedInfo(p.source));
      }
      this.rebuild();
    }, 0);
  }

  private rebuild(): void {
    this.teardown();
    this.generation++;
    for (const fn of [...this.subs]) fn();
  }

  private teardown(): void {
    this.frame?.destroy();
    this.frame = null;
    this.ready = false;
    this.queue = [];
    this.sent.clear();
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) {
      clearTimeout(p.timer);
      p.resolve(null);
    }
  }
}

// The iframe's whole document: a CSP that allows the scripts to run and nothing to leave.
const CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; form-action 'none'; base-uri 'none'";

/** The script the iframe boots: the runtime in a worker, so a hung script never blocks a page. */
export function bootScript(): string {
  const rt = widgetRuntime.toString();
  return `"use strict";
const RT = ${rt};
const up = (m, t) => parent.postMessage(m, "*", t || []);
let send = null;
const inline = () => { send = RT(up); up({ t: "ready", mode: "inline" }); };
try {
  const code = "const h = (" + RT.toString() + ")((m, t) => self.postMessage(m, t || []));" +
    "self.onmessage = (e) => h(e.data); self.postMessage({ t: 'up' });";
  const w = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
  let alive = false;
  w.onmessage = (e) => {
    const m = e.data;
    if (m && m.t === "up") { alive = true; up({ t: "ready", mode: "worker" }); return; }
    up(m, m && m.bitmap ? [m.bitmap] : []);
  };
  w.onerror = () => { if (!alive) { alive = true; w.terminate(); inline(); } };
  send = (m) => w.postMessage(m);
} catch (e) { inline(); }
addEventListener("message", (e) => { if (e.source === parent && send) send(e.data); });`;
}

/** The iframe's srcdoc. */
export function sandboxDocument(): string {
  const boot = bootScript().replace(/<\/script/gi, "<\\/script");
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><script>${boot}</script>`;
}

/** The real host: a hidden iframe appended to the page, heard through window messages. */
export function iframeHost(doc: Document = document): SandboxHost {
  const win = doc.defaultView as Window;
  return {
    createFrame() {
      const el = doc.createElement("iframe");
      el.setAttribute("sandbox", "allow-scripts");
      el.setAttribute("aria-hidden", "true");
      el.tabIndex = -1;
      el.style.cssText =
        "position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none";
      el.srcdoc = sandboxDocument();
      doc.body.appendChild(el);
      return {
        post(msg) {
          // An opaque origin has no name to target, so "*": what goes in is params and taps, never a secret.
          el.contentWindow?.postMessage(msg, "*");
        },
        isSource: (s) => s !== null && s === el.contentWindow,
        destroy: () => el.remove(),
      };
    },
    listen(on) {
      const fn = (e: MessageEvent): void => on(e.source, e.data);
      win.addEventListener("message", fn);
      return () => win.removeEventListener("message", fn);
    },
  };
}

let shared: WidgetSandbox | null = null;

/** The page's one sandbox, made on first use. */
export function widgetSandbox(): WidgetSandbox {
  if (!shared) shared = new WidgetSandbox(iframeHost());
  return shared;
}
