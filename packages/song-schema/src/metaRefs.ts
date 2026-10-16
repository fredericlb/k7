// metaRefs.ts — the `@meta/…` refs: the app's own built-ins (a lane, a note, an unsupported
// plugin's placeholder) and the curves an automation binding names. None of them has a
// folder, so a ref is all there is. Re-exported by moduleTypes.ts; see docs/moduleTypes.md.

/** How a chain names a BUILT-IN — `@meta/track`, `@meta/IN` — the app's own vocabulary, never a scanned plugin (docs/moduleTypes.md). */
export const META_NS = "@meta";
export const metaRef = (slug: string): string => `${META_NS}/${slug}`;

// --- curve refs (see packages/song/docs/curves.md) -------------------------------

/** The type folder a curve ref names — the file still lives at `curves/<id>.yaml`, per-project; this is REF-CONSISTENCY only. */
const CURVES_CATEGORY = "curves";
const CURVE_REF_PREFIX = `${META_NS}/${CURVES_CATEGORY}/`;

/** How an automation binding names a curve: `@meta/curves/sweep` — docs/curves.md. */
export const curveRef = (id: string): string => `${CURVE_REF_PREFIX}${id}`;

/** The bare curve id an authored `curve:` field names, whichever form it was written in — docs/curves.md. */
export const curveIdFromRef = (ref: string): string =>
  ref.startsWith(CURVE_REF_PREFIX) ? ref.slice(CURVE_REF_PREFIX.length) : ref;

// --- the doc module (see docs/docModules.md) -------------------------------------

/** `@meta/doc` — the module every note on the graph is a NODE of, and it names no folder (docs/moduleTypes.md). */
export const DOC_CATEGORY = "docs";
export const DOC_REF = `${META_NS}/doc`;

// --- the not-supported module (see packages/song/docs/notSupported.md) -----------

/** `@meta/not-supported` — what a node stands on when the plugin it WAS is one k7 cannot load. */
export const NOT_SUPPORTED_REF = `${META_NS}/not-supported`;

/** Its category: not a type folder, so nothing can be authored under it — the module has no folder. */
export const NOT_SUPPORTED_CATEGORY = "misc";

/** Is this what an unsupported plugin's node extends? One spelling, so a typo cannot half-work. */
export const isNotSupportedRef = (ref: unknown): boolean =>
  ref === NOT_SUPPORTED_REF;

// --- the track modules (see docs/trackModules.md) --------------------------------

/** The three modules a LANE is a node of — three and not five, since a lane is not typed by its signal (docs/trackModules.md). */
export const TRACK_REF = `${META_NS}/track`;
export const STRUDEL_TRACK_REF = `${META_NS}/strudel-track`;
export const GROUP_TRACK_REF = `${META_NS}/group-track`;

export const TRACK_REFS = [
  TRACK_REF,
  STRUDEL_TRACK_REF,
  GROUP_TRACK_REF,
] as const;

/** The two output ports every non-group lane offers, from `@studio/graph-model` so the renderer cannot disagree (docs/moduleTypes.md). */
export {
  TRACK_OUT_AUDIO,
  TRACK_OUT_MIDI,
  TRACK_OUTPUTS,
} from "@studio/graph-model";

/** The signal-typed lane refs a project on disk may carry, for the DIAGNOSTIC alone — nothing resolves these (docs/moduleTypes.md). */
export const LEGACY_TRACK_REFS: Record<string, string> = {
  [`${META_NS}/audio-track`]: TRACK_REF,
  [`${META_NS}/sequence-track`]: TRACK_REF,
  [`${META_NS}/audio-strudel-track`]: STRUDEL_TRACK_REF,
  [`${META_NS}/sequence-strudel-track`]: STRUDEL_TRACK_REF,
};

/** Is this what a lane extends? Asked of an authored `extends:`, before anything is resolved. */
export const isTrackRef = (ref: unknown): boolean =>
  (TRACK_REFS as readonly unknown[]).includes(ref);
