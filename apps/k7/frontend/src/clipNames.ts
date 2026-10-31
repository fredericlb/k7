// clipNames.ts — what a clip is CALLED on screen. A take's id (`gtr_9.1_261030T172747`) and a new
// sequence's (`keys-seq-1`) are generated, so they read as their lane plus a take bar or a number;
// a clip someone named is shown as named. The id stays the tooltip's — docs/timeline.md.

import { materialRefOf } from "@studio/song-schema/placementId";
import { trackLabel } from "@studio/song-schema/trackKind";

/** A clip ref read as what a person recognises; `copy` is the `-n` a processed copy of a take carries. */
export type ClipNameParts =
  | { kind: "take"; lane: string; bar: number; copy?: number }
  | { kind: "sequence"; lane: string; n: number }
  | { kind: "named"; name: string };

// `{lane}_{bar}.{beat}_{yymmdd}T{hhmmss}`, then `-n` per processed copy — take-render's recordTake.ts.
const TAKE = /^(.+)_(\d+)\.\d+_\d{6}T\d{6}(?:-(\d+))?$/;
// `{lane}-seq-{n}` — the sequence `sequence empty` makes on a lane.
const SEQUENCE = /^(.+)-seq-(\d+)$/;

/** Split a clip ref (or a placement id `ref@start`, nested or not) into the parts its shown name is made of. */
export function clipNameParts(ref: string): ClipNameParts {
  const material = materialRefOf(ref);
  const take = TAKE.exec(material);
  if (take)
    return {
      kind: "take",
      lane: take[1],
      bar: Number(take[2]),
      ...(take[3] ? { copy: Number(take[3]) } : {}),
    };
  const seq = SEQUENCE.exec(material);
  if (seq) return { kind: "sequence", lane: seq[1], n: Number(seq[2]) };
  return { kind: "named", name: material };
}

/** The words a shown name is spelled with — the app's messages, passed in so this stays pure. */
export interface ClipNameWords {
  take: (p: { lane: string; bar: number }) => string;
  sequence: (p: { lane: string; n: number }) => string;
}

/** A lane token as its lane is labelled, from the lanes' ids — a take's token is its lane id, made filename-safe. */
export function laneNamer(
  tracks: readonly { id: string; name: string }[],
): (token: string) => string {
  const by = new Map<string, string>();
  for (const t of tracks) {
    const label = trackLabel(t.name || t.id);
    by.set(t.id, label);
    by.set(t.id.replace(/[^A-Za-z0-9._-]/g, "-"), label);
  }
  return (token) => by.get(token) ?? token;
}

/** The name a clip is shown by: a generated id read as its lane and bar or number, an authored one as written. */
export function clipShownName(
  ref: string,
  laneName: (token: string) => string,
  words: ClipNameWords,
  // The label of the lane the clip sits on, for an id whose lane token names no lane any more (a lane renamed since the take).
  ownLane?: string,
): string {
  const p = clipNameParts(ref);
  if (p.kind === "named") return p.name;
  const known = laneName(p.lane);
  const lane = known === p.lane && ownLane ? ownLane : known;
  if (p.kind === "sequence") return words.sequence({ lane, n: p.n });
  const base = words.take({ lane, bar: p.bar });
  return p.copy ? `${base} (${p.copy})` : base;
}
