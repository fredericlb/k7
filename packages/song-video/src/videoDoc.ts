// videoDoc.ts — the PICTURE document: what a song's `video_tracks/` compile to. Every time in
// it is a decimal second, because a shot is cut against the wall clock and not a bar line.
// Its own document rather than a section of ProjectDoc, which is what keeps the frame out of
// everything the C++ engine is handed. Full rationale: docs/picture.md.

// A placed shot. `source` is ABSOLUTE — the same rule a ClipDoc's is: whoever renders knows
// nothing about where the project folder sits.
export interface VideoClipDoc {
  id: string;
  name: string;
  source: string; // absolute path
  start: number; // seconds on the timeline
  length: number; // seconds; 0 == the source's natural length
  sourceFrom: number; // seconds, the in-point INTO the source
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

/** A shader's two stages, read off the module's `shaders/<name>/` and carried INLINE — the
 *  browser cannot open a folder, and a page of GLSL is smaller than the route that would serve
 *  it. See docs/shaders.md. */
export interface ShaderSourceDoc {
  name: string;
  vertex: string;
  fragment: string;
}

// A video chain's step, folded onto its lane so the renderer applies it per placement; VIDEO_OUT is the sink.
export interface VideoPluginDoc {
  id: string; // "<trackId>:<stepIndex>" — the renderer's per-instance key
  type: "video_effect" | "video_transition" | "shader"; // mirrors the module's `type`
  name: string; // the module NODE's name — what the graph calls this card
  enabled: boolean; // chain step `enabled`; false == bypassed by the renderer
  params: Record<string, number>;
  /**
   * A SHADER's program, already read. Absent on the other two types, and absent on a shader node
   * with nothing picked — or one whose folder has not synced — which the renderer draws as a pass
   * that lets its picture through.
   */
  shader?: ShaderSourceDoc;
  /**
   * The LANE whose live level drives this shader's `uAudio`, when one is wired to its audio port.
   *
   * A name and not a number, because the level is not in this document: the engine pushes it at
   * ~20 Hz against the track list, and the surface holding that stream is the one that can look
   * it up. Compiling a value here would freeze a moving number into a cached document.
   */
  audioFrom?: string;
}

// A lane: "video" links picture and places it at (x,y,w,h), "shape" draws parametric shapes.
// @studio/ui-eyes is the only consumer. Already in project.layers draw order.
export interface VideoTrackDoc {
  id: string;
  name: string;
  color: string;
  mute: boolean; // hidden
  kind: "video" | "shape";
  x: number;
  y: number;
  w: number;
  h: number;
  clips: VideoClipDoc[]; // "video" tracks only
  shapes: ShapeDoc[]; // "shape" tracks only
  // This lane's own video run, compiled — applied to the layer BEFORE it is composited. Absent on
  // a lane no run starts at, which is every lane in a project that draws no shaders.
  plugins?: VideoPluginDoc[];
}

/** A named point on the cut, in seconds. `tc` is the key it is stored under, which is its delete key. */
export interface VideoMarker {
  sec: number;
  name: string;
  tc: string;
}

/**
 * A song's compiled PICTURE.
 *
 * Deliberately NOT a section of ProjectDoc, and not a ProjectDoc with the audio left empty.
 * There is no tempo here, so there is no beat, no time signature and no sample rate — three
 * fields that would have to be invented and then ignored. The two documents describe one
 * folder, share their lanes' SHAPE, and agree on nothing else.
 */
export interface VideoProjectDoc {
  uuid?: string; // stable project id; absent until something writes one
  name: string;
  viewport: [number, number]; // px the lanes draw into
  fps: number; // frame-by-frame export only — realtime follows the transport's own clock
  videoTracks: VideoTrackDoc[]; // ALREADY in project.layers draw order — no consumer re-sorts
  markers: VideoMarker[]; // sorted by second
  /**
   * The `RENDER -> VIDEO_OUT` run: passes over the frame the lanes were composited INTO.
   *
   * The picture's `masterPlugins`, and named for the same distinction — a lane's own plugins work
   * that layer, these work the sum. Always present and empty by default, unlike a lane's
   * `plugins`, because this one is a property of the project rather than of anything in it.
   */
  framePlugins: VideoPluginDoc[];
}
