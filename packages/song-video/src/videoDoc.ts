// videoDoc.ts — the PICTURE document: what a song's `video_tracks/` compile to. Every time in
// it is a decimal second, because a shot is cut against the wall clock and not a bar line.
// Its own document rather than a section of ProjectDoc, which is what keeps the frame out of
// everything the C++ engine is handed. Full rationale: docs/picture.md.

// A placed shot; `source` is ABSOLUTE, since whoever renders knows nothing about the project folder.
export interface VideoClipDoc {
  id: string;
  name: string;
  source: string; // absolute path
  start: number; // seconds on the timeline
  length: number; // seconds; 0 == the source's natural length
  sourceFrom: number; // seconds, the in-point INTO the source
  // How this shot arrives and leaves; absent is a hard cut — see docs/transitions.md.
  fadeIn?: VideoFadeDoc;
  fadeOut?: VideoFadeDoc;
}

/** A transition ON a placement: how long, and which kind. The kind's GLSL is on the PROJECT, once per name. */
export interface VideoFadeDoc {
  over: number; // seconds
  with: string; // a modules/video_transitions/ name, or DISSOLVE
}

/** A transition's two stages, read off `modules/video_transitions/<name>/` and carried INLINE. */
// Keyed by NAME rather than per instance: one program serves every cut that names it.
export interface VideoTransitionDoc {
  name: string;
  vertex: string;
  fragment: string;
  params: Record<string, number>; // P1..P4, clamped 0..1 at compile
}

// A shape drawn straight onto the viewport, in px. A square/text x,y is its top-left, a circle's its CENTRE.
export type ShapeDoc =
  | {
      type: "square";
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
    }
  | { type: "circle"; x: number; y: number; r: number; color: string }
  | {
      type: "text";
      content: string;
      font: string;
      fontSize: number;
      x: number;
      y: number;
      w?: number; // optional max width (text condenses to fit)
      color: string;
    };

/** A shader's two stages, read off `shaders/<name>/` and carried INLINE — see docs/shaders.md. */
export interface ShaderSourceDoc {
  name: string;
  vertex: string;
  fragment: string;
}

// A video chain's step, folded onto its lane so the renderer applies it per placement; VIDEO_OUT is the sink.
export interface VideoPluginDoc {
  id: string; // "<trackId>:<stepIndex>" — the renderer's per-instance key
  // Mirrors the module's `type`, minus `video_transition`: one is never a chain step, docs/transitions.md.
  type: "video_effect" | "shader";
  name: string; // the module NODE's name — what the graph calls this card
  enabled: boolean; // chain step `enabled`; false == bypassed by the renderer
  params: Record<string, number>;
  /** A SHADER's program, already read — absent means a pass that lets its picture through. */
  shader?: ShaderSourceDoc;
  /** The LANE whose live level drives this shader's `uAudio` — a NAME, not a number; docs/shaders.md. */
  audioFrom?: string;
}

// A lane: "video" places picture at (x,y,w,h), "shape" draws parametric shapes, in layer draw order.
export interface VideoTrackDoc {
  id: string;
  name: string;
  color: string;
  mute: boolean; // hidden
  /** Soloed, from `project.yaml`'s `soloed:` — the same list audio uses, resolved within picture (docs/picture.md). */
  solo: boolean;
  kind: "video" | "shape";
  x: number;
  y: number;
  w: number;
  h: number;
  clips: VideoClipDoc[]; // "video" tracks only
  shapes: ShapeDoc[]; // "shape" tracks only
  // This lane's own video run, applied to the layer BEFORE it is composited; absent when it has none.
  plugins?: VideoPluginDoc[];
  /** A live CAMERA feeds this lane instead of its placements — the LABEL a node wired to it names,
   *  and "" for whichever this machine calls default. Absent is the ordinary lane (docs/camera.md). */
  camera?: string;
  /** …and WHEN that lens is opened: `off` never, `auto` while the lane is armed, `on` always. */
  cameraMonitor?: CameraMonitor;
}

/** When a lens is opened — the audio input's three words, meaning SHOWN rather than heard. */
export type CameraMonitor = "off" | "auto" | "on";

/** A named point on the cut, in seconds. `tc` is the key it is stored under, which is its delete key. */
export interface VideoMarker {
  sec: number;
  name: string;
  tc: string;
}

/** A song's compiled PICTURE — deliberately not a section of `ProjectDoc`, see docs/picture.md. */
export interface VideoProjectDoc {
  uuid?: string; // stable project id; absent until something writes one
  name: string;
  viewport: [number, number]; // px the lanes draw into
  fps: number; // frame-by-frame export only — realtime follows the transport's own clock
  videoTracks: VideoTrackDoc[]; // ALREADY in project.layers draw order — no consumer re-sorts
  markers: VideoMarker[]; // sorted by second
  /** The `RENDER -> VIDEO_OUT` run — the picture's `masterPlugins`, always present; docs/shaders.md. */
  framePlugins: VideoPluginDoc[];
  /** Every transition a placement NAMES, by name; the built-in dissolve is absent — the renderer owns it. */
  transitions: Record<string, VideoTransitionDoc>;
  /** What compiled but is not right — a shot naming no clip, say. A THROW is for a picture that
   *  cannot be built at all; this is for the ones that build and then draw nothing (docs/picture.md). */
  warnings: string[];
}
