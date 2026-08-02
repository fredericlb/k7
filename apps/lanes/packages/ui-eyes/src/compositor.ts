// compositor.ts — the viewport in WebGL2: one texture per layer, one textured quad each,
// composited bottom-first in a single pass. The ONE renderer both drivers share, because
// texImage2D takes an HTMLVideoElement and a VideoFrame identically — so it never learns
// which driver owns it. It OWNS its canvas (a React-owned one races two GL contexts).

import type { SceneShape, VideoScene } from "./scene";

const VERT = `#version 300 es
in vec2 aUnit;                 // a unit quad, (0,0)..(1,1)
uniform vec4 uRect;            // target rect in clip space: (x0, y0, x1, y1)
out vec2 vUV;
void main() {
  vUV = vec2(aUnit.x, aUnit.y);
  vec2 p = mix(uRect.xy, uRect.zw, aUnit);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 outColor;
void main() { outColor = texture(uTex, vUV); }`;

interface LayerGL {
  id: string;
  tex: WebGLTexture;
  rect: [number, number, number, number]; // clip space, precomputed from the viewport
  hasFrame: boolean; // nothing uploaded yet -> don't draw (avoids a black or garbage quad)
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error(`eyes: shader compile failed: ${gl.getShaderInfoLog(sh)}`);
  return sh;
}

// The viewport has a top-left origin, clip space is bottom-left: map a viewport-px rect to clip space, flipping y.
function rectToClip(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
): [number, number, number, number] {
  const x0 = (x / vw) * 2 - 1;
  const x1 = ((x + w) / vw) * 2 - 1;
  const y0 = 1 - (y / vh) * 2; // top edge
  const y1 = 1 - ((y + h) / vh) * 2; // bottom edge
  return [x0, y1, x1, y0]; // (x0,y0)=bottom-left, (x1,y1)=top-right for the unit-quad lerp
}

// Rasterize a shape layer to a 2D canvas at viewport resolution — the whole reason shapes reuse the textured path:
// Canvas2D draws rects, arcs and real TEXT and parses CSS colours, which raw WebGL can't without a glyph atlas.
// Static, so it happens once per scene, and the result composites exactly like a video frame.
function rasterizeShapes(
  shapes: SceneShape[],
  vw: number,
  vh: number,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(vw, vh);
  const ctx = canvas.getContext("2d")!;
  for (const s of shapes) {
    ctx.fillStyle = s.color;
    if (s.type === "square") {
      ctx.fillRect(s.x, s.y, s.w, s.h);
    } else if (s.type === "circle") {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.font = `${s.fontSize}px ${s.font}`;
      ctx.textBaseline = "top";
      // `w` is a MAX width: Canvas condenses the glyphs to fit rather than wrapping (single-line text for v1).
      if (s.w != null) ctx.fillText(s.content, s.x, s.y, s.w);
      else ctx.fillText(s.content, s.x, s.y);
    }
  }
  return canvas;
}

function readClearColor(el: HTMLElement): [number, number, number] {
  const v = getComputedStyle(el).getPropertyValue("--sh-background").trim();
  const n = v.startsWith("#") ? parseInt(v.slice(1), 16) : NaN;
  if (Number.isNaN(n)) return [0.06, 0.07, 0.08]; // matches the token's dark default
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class Compositor {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private uRect: WebGLUniformLocation;
  private layers: LayerGL[] = [];
  private clear: [number, number, number];
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;

  private constructor(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    gl: WebGL2RenderingContext,
    clear: [number, number, number],
  ) {
    this.canvas = canvas;
    this.gl = gl;
    this.clear = clear;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(
        `eyes: program link failed: ${gl.getProgramInfoLog(prog)}`,
      );
    this.prog = prog;
    this.uRect = gl.getUniformLocation(prog, "uRect")!;

    // One unit quad, shared by every layer (the per-layer rect is a uniform).
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    // two triangles over (0,0)..(1,1)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aUnit = gl.getAttribLocation(prog, "aUnit");
    gl.enableVertexAttribArray(aUnit);
    gl.vertexAttribPointer(aUnit, 2, gl.FLOAT, false, 0, 0);

    // Video frames arrive top-down; GL textures are bottom-up. Flip on upload so the texcoords stay the obvious 0..1.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    // Straight-alpha over, so a shape's background_color can blend; video textures are opaque, so it is a no-op there.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  // The compositor makes its own canvas for the realtime path; export passes an OffscreenCanvas it owns. Either way
  // the backing store is the viewport's pixel size — the model — and CSS scales the display.
  static create(
    target: HTMLElement | OffscreenCanvas,
    scene: VideoScene,
  ): Compositor {
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    let clear: [number, number, number];
    if (target instanceof OffscreenCanvas) {
      canvas = target;
      clear = [0.06, 0.07, 0.08];
    } else {
      const c = document.createElement("canvas");
      c.style.display = "block";
      c.style.width = "100%";
      c.style.height = "100%";
      target.appendChild(c);
      canvas = c;
      clear = readClearColor(target);
    }
    canvas.width = scene.viewport[0];
    canvas.height = scene.viewport[1];
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true, // export reads pixels back after draw
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("eyes: WebGL2 is not available");
    const comp = new Compositor(canvas, gl, clear);
    comp.setScene(scene);
    return comp;
  }

  // (Re)build the per-layer textures and quads. Textures allocate lazily on first upload; this reserves the slots.
  setScene(scene: VideoScene): void {
    const gl = this.gl;
    for (const l of this.layers) gl.deleteTexture(l.tex);
    this.canvas.width = scene.viewport[0];
    this.canvas.height = scene.viewport[1];
    const [vw, vh] = scene.viewport;
    this.layers = scene.layers.map((l) => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // A SHAPE layer rasterizes now and uploads at once, so it draws like a video frame; a video layer's texture stays
      // empty — and skipped — until its first frame arrives.
      if (l.shapes?.length) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          rasterizeShapes(l.shapes, vw, vh),
        );
        return {
          id: l.id,
          tex,
          rect: rectToClip(0, 0, vw, vh, vw, vh),
          hasFrame: true,
        };
      }
      return {
        id: l.id,
        tex,
        rect: rectToClip(l.x, l.y, l.w, l.h, vw, vh),
        hasFrame: false,
      };
    });
  }

  // Upload a frame from a <video> or a VideoFrame; cheap per rAF, and skippable when no new frame was produced.
  upload(layerId: string, src: TexImageSource): void {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, layer.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    layer.hasFrame = true;
  }

  // Draw every visible layer bottom-first. One with no frame yet is skipped, so a lane between clips shows the
  // background through rather than a stale or black quad.
  draw(visible: Set<string>): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(this.clear[0], this.clear[1], this.clear[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL call, not a React hook — the rule misfires on the `use` prefix.
    gl.useProgram(this.prog);
    for (const layer of this.layers) {
      if (!layer.hasFrame || !visible.has(layer.id)) continue;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, layer.tex);
      gl.uniform4fv(this.uRect, layer.rect);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  // Set the DISPLAY size only: the backing store stays the viewport's, so the model is resolution-independent.
  resize(cssW: number, cssH: number): void {
    if (this.canvas instanceof HTMLCanvasElement) {
      this.canvas.style.width = `${cssW}px`;
      this.canvas.style.height = `${cssH}px`;
    }
  }

  destroy(): void {
    const gl = this.gl;
    for (const l of this.layers) gl.deleteTexture(l.tex);
    this.layers = [];
    gl.deleteProgram(this.prog);
    if (this.canvas instanceof HTMLCanvasElement) this.canvas.remove();
  }
}
