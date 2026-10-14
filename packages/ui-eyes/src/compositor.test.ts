// The compositor's TRANSITION path, against a recording fake GL context — the same posture
// passes.test.ts states: a fake cannot prove a pixel, but the bugs here are sequencing (which
// blend func is in force for which draw, which texture is on which unit, what gets allocated at
// all) and none of those needs one. See song-video/docs/transitions.md.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Compositor } from "./compositor";
import { coverUV, sourceAR } from "./geometry";
import type { SceneClip, SceneTransition, VideoScene } from "./scene";

type Log = string[];

/** A WebGL2 context that records instead of drawing, plus the OffscreenCanvas the compositor is handed. */
function fakeTarget() {
  const log: Log = [];
  const uniforms = new Map<string, unknown[]>();
  let ids = 0;
  const next = (kind: string) => ({ kind, id: ++ids });
  const textures: { id: number }[] = [];
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    TEXTURE_2D: 5,
    RGBA: 6,
    UNSIGNED_BYTE: 7,
    TEXTURE_MIN_FILTER: 8,
    TEXTURE_MAG_FILTER: 9,
    TEXTURE_WRAP_S: 10,
    TEXTURE_WRAP_T: 11,
    LINEAR: 12,
    CLAMP_TO_EDGE: 13,
    FRAMEBUFFER: 14,
    COLOR_ATTACHMENT0: 15,
    COLOR_BUFFER_BIT: 16,
    TRIANGLES: 17,
    BLEND: 18,
    SRC_ALPHA: 19,
    ONE_MINUS_SRC_ALPHA: 20,
    ONE: 21,
    ARRAY_BUFFER: 22,
    STATIC_DRAW: 23,
    FLOAT: 24,
    TEXTURE0: 33984,
    TEXTURE1: 33985,
    UNPACK_FLIP_Y_WEBGL: 25,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 26,
    createShader: () => next("shader"),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => "boom",
    deleteShader: () => {},
    createProgram: () => next("program"),
    attachShader: () => {},
    bindAttribLocation: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => "boom",
    deleteProgram: () => log.push("deleteProgram"),
    getUniformLocation: (_p: unknown, name: string) => ({ name }),
    useProgram: (p: { id: number }) => log.push(`useProgram(${p.id})`),
    uniform1i: (l: { name: string }, v: number) => {
      uniforms.set(l.name, [v]);
      log.push(`uniform1i(${l.name},${v})`);
    },
    uniform1f: (l: { name: string }, v: number) => {
      uniforms.set(l.name, [v]);
      log.push(`uniform1f(${l.name},${v})`);
    },
    uniform2f: () => {},
    uniform4fv: () => log.push("uniform4fv(uRect)"),
    createTexture: () => {
      const t = next("texture");
      textures.push(t);
      return t;
    },
    bindTexture: (_t: unknown, tex: { id: number } | null) =>
      log.push(`bindTexture(${tex ? tex.id : 0})`),
    texImage2D: () => log.push("texImage2D"),
    uniform4f: () => {},
    texParameteri: () => {},
    activeTexture: (u: number) => log.push(`activeTexture(${u - 33984})`),
    createFramebuffer: () => {
      log.push("createFramebuffer");
      return next("fbo");
    },
    bindFramebuffer: (_t: unknown, f: { id: number } | null) =>
      log.push(`bindFramebuffer(${f ? f.id : "canvas"})`),
    framebufferTexture2D: () => {},
    deleteFramebuffer: () => {},
    deleteTexture: () => log.push("deleteTexture"),
    createBuffer: () => next("buffer"),
    bindBuffer: () => {},
    bufferData: () => {},
    getAttribLocation: () => 0,
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    pixelStorei: () => {},
    enable: () => log.push("enable(BLEND)"),
    disable: () => log.push("disable(BLEND)"),
    blendFunc: (s: number, _d: number) =>
      log.push(s === 21 ? "blendFunc(PREMULTIPLIED)" : "blendFunc(STRAIGHT)"),
    viewport: () => {},
    clearColor: (r: number, g: number, b: number) =>
      log.push(`clearColor(${r},${g},${b})`),
    clear: () => log.push("clear"),
    drawArrays: () => log.push("drawArrays"),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => gl as unknown as WebGL2RenderingContext,
  };
  return { canvas, gl, log, uniforms, textures };
}

// The compositor branches on `target instanceof OffscreenCanvas`, so the fake must BE one here.
class FakeOffscreen {}
beforeEach(() => {
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = FakeOffscreen;
});
afterEach(() => {
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = undefined;
  vi.restoreAllMocks();
});

const clip = (over: Partial<SceneClip> = {}): SceneClip => ({
  id: "a",
  src: "a.mp4",
  start: 0,
  length: 4,
  sourceFrom: 0,
  ...over,
});

const scene = (
  clips: SceneClip[],
  transitions?: Record<string, SceneTransition>,
): VideoScene => ({
  viewport: [64, 32],
  fps: 30,
  durationSec: 10,
  layers: [{ id: "main", hidden: false, x: 0, y: 0, w: 64, h: 32, clips }],
  ...(transitions ? { transitions } : {}),
});

/** Build a compositor over the fake, the way `create` does for an export. */
function make(s: VideoScene) {
  const t = fakeTarget();
  Object.setPrototypeOf(t.canvas, FakeOffscreen.prototype);
  const comp = Compositor.create(t.canvas as unknown as OffscreenCanvas, s);
  return { comp, ...t };
}

const fbos = (log: Log) => log.filter((l) => l === "createFramebuffer").length;

describe("what a scene allocates", () => {
  it("allocates no offscreen target for a song with no fade and no shader", () => {
    // The standing rule: a song that needs no scratch pays for none.
    expect(fbos(make(scene([clip()])).log)).toBe(0);
  });

  it("still allocates the scratch for a song that dissolves but has no shader", () => {
    // Without this the ping-pong is absent and the transition silently never runs.
    const { log } = make(
      scene([clip({ fadeIn: { over: 1, with: "dissolve" } })]),
    );
    expect(fbos(log)).toBe(2); // the ping-pong pair, and no frame target
  });

  it("gives a lane that never dissolves NO second picture slot", () => {
    // One decoder and one texture per lane is the standing rule; a fade_in is what buys the second.
    const { comp, log } = make(scene([clip()]));
    log.length = 0;
    comp.upload("main", {} as TexImageSource, 1);
    expect(log).not.toContain("texImage2D");
  });

  it("…and a lane that does gets one", () => {
    const { comp, log } = make(
      scene([clip({ fadeIn: { over: 1, with: "dissolve" } })]),
    );
    log.length = 0;
    comp.upload("main", {} as TexImageSource, 1);
    expect(log).toContain("texImage2D");
  });
});

describe("drawing a blend", () => {
  const dissolving = () =>
    make(scene([clip({ fadeIn: { over: 1, with: "dissolve" } })]));

  it("puts uFrom on unit 0 and uTo on unit 1", () => {
    const { comp, uniforms } = dissolving();
    comp.draw(
      new Set(["main"]),
      new Map([
        ["main", { name: "dissolve", progress: 0.25, from: true, to: true }],
      ]),
    );
    expect(uniforms.get("uFrom")).toEqual([0]);
    expect(uniforms.get("uTo")).toEqual([1]);
    expect(uniforms.get("uProgress")).toEqual([0.25]);
  });

  it("composites the blended layer PREMULTIPLIED, and puts the func back", () => {
    // mix() of two premultiplied colours is both a cross-dissolve and a fade to nothing; under
    // straight alpha the same mix darkens as it fades, which is a dissolve that dips through black.
    const { comp, log } = dissolving();
    comp.draw(
      new Set(["main"]),
      new Map([
        ["main", { name: "dissolve", progress: 0.5, from: true, to: true }],
      ]),
    );
    const pre = log.indexOf("blendFunc(PREMULTIPLIED)");
    expect(pre).toBeGreaterThan(-1);
    expect(log.slice(pre).indexOf("blendFunc(STRAIGHT)")).toBeGreaterThan(0);
  });

  it("leaves the func alone for an ordinary layer — a shader's alpha stays STRAIGHT", () => {
    const { comp, log } = make(scene([clip()]));
    comp.upload("main", {} as TexImageSource);
    comp.draw(new Set(["main"]));
    expect(log).not.toContain("blendFunc(PREMULTIPLIED)");
  });

  it("binds the transparent texel for a side with no picture this frame", () => {
    // A fade_out has no incoming shot, and that is the SAME code path rather than a second one.
    const { comp, log, textures } = dissolving();
    log.length = 0;
    comp.draw(
      new Set(["main"]),
      new Map([
        ["main", { name: "dissolve", progress: 0.5, from: true, to: false }],
      ]),
    );
    // The empty texel is the first texture the compositor ever made.
    const empty = textures[0].id;
    const at1 = log.indexOf("activeTexture(1)");
    expect(log[at1 + 1]).toBe(`bindTexture(${empty})`);
  });

  it("draws a blended layer even before slot 0 ever had an upload", () => {
    // `hasFrame` never resets, so it cannot answer "this frame"; the blend says which slots are live.
    const { comp, log } = dissolving();
    log.length = 0;
    comp.draw(
      new Set(["main"]),
      new Map([
        ["main", { name: "dissolve", progress: 0, from: false, to: true }],
      ]),
    );
    expect(log).toContain("drawArrays");
  });

  it("falls back to the dissolve for an unknown kind, and says so ONCE", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { comp } = dissolving();
    const blends = new Map([
      ["main", { name: "gone", progress: 0.5, from: true, to: true }],
    ]);
    comp.draw(new Set(["main"]), blends);
    comp.draw(new Set(["main"]), blends);
    expect(
      warn.mock.calls.filter((c) => String(c[0]).includes("gone")),
    ).toHaveLength(1);
  });

  it("compiles a NAMED kind and runs that program instead", () => {
    const { comp, uniforms } = make(
      scene([clip({ fadeIn: { over: 1, with: "wipe" } })], {
        wipe: {
          name: "wipe",
          vertex: "// v",
          fragment: "// f",
          params: { P1: 0.75, P2: 0, P3: 0, P4: 0 },
        },
      }),
    );
    comp.draw(
      new Set(["main"]),
      new Map([["main", { name: "wipe", progress: 1, from: true, to: true }]]),
    );
    expect(uniforms.get("uP1")).toEqual([0.75]);
  });
});

describe("a fade's STRETCH", () => {
  const iris = {
    id: "iris:0",
    name: "iris",
    vertex: "// v",
    fragment: "// f",
    enabled: true,
    params: { P1: 0, P2: 0, P3: 0, P4: 0 },
    audio: 0,
  };
  const stretching = () =>
    make({
      ...scene([clip({ fadeIn: { over: 1, with: "over", chain: "iris" } })]),
      stretches: { iris: [iris] },
    });
  const blend = (stretch?: { to: { chain: string; presence: number } }) =>
    new Map([
      [
        "main",
        {
          name: "over",
          progress: 0.25,
          from: true,
          to: true,
          ...(stretch ? { stretch } : {}),
        },
      ],
    ]);

  it("allocates a target per picture slot beside the scratch, and only when a fade names one", () => {
    expect(fbos(stretching().log)).toBe(4);
  });

  it("hands the run its shot's PRESENCE", () => {
    const { comp, uniforms } = stretching();
    comp.draw(
      new Set(["main"]),
      blend({ to: { chain: "iris", presence: 0.25 } }),
    );
    expect(uniforms.get("uPresence")).toEqual([0.25]);
  });

  it("blends the STRETCHED picture, not the slot it was uploaded into", () => {
    const { comp, log, textures } = stretching();
    // The layer's two slots are the last textures a scene makes.
    const tex2 = textures[textures.length - 1].id;
    log.length = 0;
    comp.draw(
      new Set(["main"]),
      blend({ to: { chain: "iris", presence: 0.5 } }),
    );
    const at1 = log.lastIndexOf("activeTexture(1)");
    expect(log[at1 + 1]).not.toBe(`bindTexture(${tex2})`);
    // …and with no stretch this frame, the slot itself is what the blend reads.
    log.length = 0;
    comp.draw(new Set(["main"]), blend());
    expect(log[log.lastIndexOf("activeTexture(1)") + 1]).toBe(
      `bindTexture(${tex2})`,
    );
  });

  it("owns `over` as it owns the dissolve — no fallback, no warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { comp } = stretching();
    comp.draw(new Set(["main"]), blend());
    expect(warn).not.toHaveBeenCalled();
  });
});

// A camera is 4:3 or 16:9 and the frame it lands in is whatever the project says. Sampling the
// whole texture over the whole rect stretches one into the other, which is what these remove.
describe("keeping a picture's shape", () => {
  const R = (n: number) => Math.round(n * 1e6) / 1e6;

  it("does nothing when the source already fits", () => {
    expect(coverUV(16 / 9, 16 / 9)).toEqual([1, 1, 0, 0]);
  });

  it("crops the SIDES of a wide picture in a tall frame", () => {
    // 16:9 into 9:16 — the width has to go, and evenly, or the subject drifts off-centre.
    const [sx, sy, ox, oy] = coverUV(16 / 9, 9 / 16);
    expect(R(sx)).toBe(R(9 / 16 / (16 / 9)));
    expect(sy).toBe(1);
    expect(R(ox)).toBe(R((1 - sx) / 2));
    expect(oy).toBe(0);
  });

  it("crops the TOP AND BOTTOM of a 4:3 webcam in a 16:9 frame", () => {
    const [sx, sy, ox, oy] = coverUV(4 / 3, 16 / 9);
    expect(sx).toBe(1);
    expect(R(sy)).toBe(R(4 / 3 / (16 / 9)));
    expect(ox).toBe(0);
    expect(R(oy)).toBe(R((1 - sy) / 2));
  });

  it("never shows outside the texture — the crop is a SUBSET of it", () => {
    for (const [a, b] of [
      [4 / 3, 16 / 9],
      [16 / 9, 9 / 16],
      [1, 2],
      [3, 1],
    ]) {
      const [sx, sy, ox, oy] = coverUV(a, b);
      expect(ox).toBeGreaterThanOrEqual(0);
      expect(oy).toBeGreaterThanOrEqual(0);
      expect(R(ox + sx)).toBeLessThanOrEqual(1);
      expect(R(oy + sy)).toBeLessThanOrEqual(1);
    }
  });

  it("stays identity when a source has not said its size yet", () => {
    // A layer draws before its first frame arrives; undistorted-or-not beats not at all.
    expect(coverUV(0, 16 / 9)).toEqual([1, 1, 0, 0]);
    expect(coverUV(16 / 9, 0)).toEqual([1, 1, 0, 0]);
  });

  it("reads a shape off whatever kind of source it is handed", () => {
    expect(sourceAR({ videoWidth: 640, videoHeight: 480 } as never)).toBe(
      4 / 3,
    );
    expect(sourceAR({ width: 1920, height: 1080 } as never)).toBe(16 / 9);
    expect(sourceAR({ displayWidth: 100, displayHeight: 50 } as never)).toBe(2);
    // A <video> before metadata reports 0×0, and 0 is what says "not yet".
    expect(sourceAR({ videoWidth: 0, videoHeight: 0 } as never)).toBe(0);
    expect(sourceAR({} as never)).toBe(0);
  });
});
