// The pass machinery, against a RECORDING fake GL context.
//
// A fake and not a real one, because there is no WebGL2 in this test runner and adding a native
// one to build the repo would be a heavy dependency for a handful of assertions. What it can
// still prove is the part that breaks for real: the ORDER of binds, clears and draws. The two
// bugs this pins — a layer's chain clearing the composite it accumulates into, and a chain
// blending each pass over the last instead of superseding it — are both sequencing, and neither
// needs a pixel to catch. What a fake cannot prove is that a shader draws the right picture; the
// verification for that is `docs/passes.md`'s "run it and look".

import { describe, expect, it } from "vitest";
import { compilePass, drawPass, PingPong, RenderTarget } from "./passes";
import type { ScenePass } from "./scene";

/** Every call that matters, in order, as `name(arg…)` strings. */
type Log = string[];

/** A WebGL2 context that records instead of drawing; `failCompile` fails every stage, which reaches the broken-shader path. */
function fakeGl(opts: { failCompile?: boolean } = {}) {
  const log: Log = [];
  let ids = 0;
  const next = (kind: string) => ({ kind, id: ++ids });
  const uniforms = new Map<string, unknown[]>();
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
    createShader: () => next("shader"),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => !opts.failCompile,
    getShaderInfoLog: () => "boom",
    deleteShader: () => log.push("deleteShader"),
    createProgram: () => next("program"),
    attachShader: () => {},
    bindAttribLocation: (_p: unknown, i: number, n: string) =>
      log.push(`bindAttribLocation(${i},${n})`),
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
    uniform2f: (l: { name: string }, a: number, b: number) => {
      uniforms.set(l.name, [a, b]);
      log.push(`uniform2f(${l.name},${a},${b})`);
    },
    createTexture: () => next("texture"),
    bindTexture: (_t: unknown, tex: { id: number } | null) =>
      log.push(`bindTexture(${tex ? tex.id : 0})`),
    texImage2D: () => log.push("texImage2D"),
    texParameteri: () => {},
    createFramebuffer: () => next("fbo"),
    bindFramebuffer: (_t: unknown, f: { id: number } | null) =>
      log.push(`bindFramebuffer(${f ? f.id : "canvas"})`),
    framebufferTexture2D: () => {},
    deleteFramebuffer: () => log.push("deleteFramebuffer"),
    deleteTexture: () => log.push("deleteTexture"),
    viewport: (_x: number, _y: number, w: number, h: number) =>
      log.push(`viewport(${w},${h})`),
    clearColor: (r: number, g: number, b: number, a: number) =>
      log.push(`clearColor(${r},${g},${b},${a})`),
    clear: () => log.push("clear"),
    drawArrays: () => log.push("drawArrays"),
  };
  return { gl: gl as unknown as WebGL2RenderingContext, log, uniforms };
}

const pass = (over: Partial<ScenePass> = {}): ScenePass => ({
  id: "main:0",
  name: "glow",
  vertex: "// v",
  fragment: "// f",
  enabled: true,
  params: { P1: 0.25, P2: 0.5, P3: 0, P4: 1 },
  audio: 0.75,
  ...over,
});

describe("compilePass", () => {
  it("binds the quad attribute to location 0 BEFORE linking", () => {
    // Without this a shader declaring its attributes in another order reads the quad off whatever slot the linker picked.
    const { gl, log } = fakeGl();
    expect(compilePass(gl, pass())).not.toBeNull();
    expect(log).toContain("bindAttribLocation(0,aUnit)");
  });

  it("returns null on a shader that will not build, and deletes both stages", () => {
    // A shader is source somebody is EDITING: a half-typed fragment must not take the viewport down.
    const { gl, log } = fakeGl({ failCompile: true });
    expect(compilePass(gl, pass())).toBeNull();
    expect(log.filter((l) => l === "deleteProgram")).toHaveLength(0);
    expect(log).toContain("deleteShader");
  });

  it("frees the stage objects once attached — a rebuild must not leak one per pass", () => {
    const { gl, log } = fakeGl();
    compilePass(gl, pass());
    expect(log.filter((l) => l === "deleteShader")).toHaveLength(2);
  });
});

describe("drawPass", () => {
  it("hands over every uniform in the contract", () => {
    const { gl, uniforms } = fakeGl();
    const p = compilePass(gl, pass())!;
    drawPass(gl, p, pass(), [640, 360], 12.5);
    expect(uniforms.get("uTex")).toEqual([0]); // the sampler reads texture unit 0
    expect(uniforms.get("uAudio")).toEqual([0.75]);
    expect(uniforms.get("uTime")).toEqual([12.5]);
    expect(uniforms.get("uResolution")).toEqual([640, 360]);
    expect(uniforms.get("uP1")).toEqual([0.25]);
    expect(uniforms.get("uP4")).toEqual([1]);
  });

  it("gives a knob the shader's file never set the value 0, not whatever GL had", () => {
    const { gl, uniforms } = fakeGl();
    const p = compilePass(gl, pass())!;
    drawPass(gl, p, pass({ params: {} }), [64, 64], 0);
    expect(uniforms.get("uP2")).toEqual([0]);
  });
});

describe("PingPong", () => {
  it("hands the next pass what the last one WROTE", () => {
    // The reason there are two targets: a shader may not sample the attachment it is writing.
    const { gl } = fakeGl();
    const pp = new PingPong(gl, 8, 8);
    const first = pp.frontTexture();
    pp.swap();
    expect(pp.frontTexture()).not.toBe(first);
    pp.swap();
    expect(pp.frontTexture()).toBe(first);
  });

  it("clears the back target TRANSPARENT, never to a background", () => {
    // A layer's passes run BEFORE compositing, so what the shader does not write has to stay see-through.
    const { gl, log } = fakeGl();
    new PingPong(gl, 8, 8).bindBack();
    expect(log).toContain("clearColor(0,0,0,0)");
  });
});

describe("RenderTarget", () => {
  it("clears only when asked — which is what makes the composite ACCUMULATE", () => {
    // The bug this pins: a shared ping-pong let a layer's chain clear the composite, so every layer but the last vanished.
    const { gl, log } = fakeGl();
    const t = new RenderTarget(gl, 8, 8);
    t.bind(true);
    t.bind(false);
    t.bind(false);
    expect(log.filter((l) => l === "clear")).toHaveLength(1);
    // …and it is still the same framebuffer each time, so the later draws land on what the first one wrote.
    const binds = log.filter((l) => l.startsWith("bindFramebuffer"));
    expect(new Set(binds.slice(-3)).size).toBe(1);
  });
});
