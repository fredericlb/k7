// timelineTools.ts — what a PRESS on a clip means, which is the tool's axis; the MODE's is where
// the keyboard is (timelineMode.ts). Every tool stands on ONE verb, so a gesture stays one command
// and one Ctrl+Z — which is why there is no pencil here: `event add` places a clip that already
// exists, so drawing one would be `sequence new` and then `event add`, two entries for one gesture.
// See apps/k7/frontend/docs/timeline.md.

import { m } from "./paraglide/messages.js";

/** The pointer is the tool with no verb: it means the grab, the marquee and the caret, as before. */
export const TOOLS = ["pointer", "cut", "erase", "mute", "crossfade"] as const;
export type Tool = (typeof TOOLS)[number];

export const isTool = (s: string): s is Tool =>
  (TOOLS as readonly string[]).includes(s);

/** What each tool does, for the strip's tooltip and its accessible name (docs/timeline.md). */
export const TOOL_LABEL: Record<Tool, () => string> = {
  pointer: () => m["tool.pointer"](),
  cut: () => m["tool.cut"](),
  erase: () => m["tool.erase"](),
  mute: () => m["tool.mute"](),
  crossfade: () => m["tool.crossfade"](),
};

/** What a press on a clip knows about it — the beats for the decisions, the timecodes for the line. */
export interface ClipTarget {
  track: string;
  name: string;
  start: number;
  /** Beats, 0 meaning the material's natural length — which is why a tail is not always knowable here. */
  length: number;
  /** Where the pointer landed, in beats. */
  at: number;
  /** `start` and `at` as timecodes — how every `event …` verb addresses a placement. */
  tc: string;
  atTc: string;
  muted?: boolean;
}

/**
 * What a press produces: a line to run, or a refusal to say out loud — the shape `PasteResult`
 * already has. `null` is the POINTER, and means the gesture underneath runs instead.
 */
export type ToolAct = { line?: string; note: string } | null;

/** Two beats that are the same one — the writers' own, since these decide whether a verb is worth sending. */
const EPS = 1e-6;

export function toolLine(tool: Tool, c: ClipTarget): ToolAct {
  switch (tool) {
    case "pointer":
      return null;
    case "cut":
      // On the head there is nothing to cut: one half would have no length. The TAIL is left to the verb — a natural length is not knowable here.
      if (c.at <= c.start + EPS)
        return {
          note: m["tool.cutAtHead"]({ name: c.name }),
        };
      if (c.length > 0 && c.at >= c.start + c.length - EPS)
        return {
          note: m["tool.cutAtTail"]({ name: c.name }),
        };
      return {
        line: `event split ${c.track} ${c.tc} ${c.atTc}`,
        note: m["tool.cutDone"]({ name: c.name, at: c.atTc }),
      };
    case "erase":
      return {
        line: `event remove ${c.track} ${c.tc}`,
        note: m["tool.erased"]({ name: c.name, track: c.track }),
      };
    case "crossfade":
      // A crossfade is between TWO events, so the timeline answers this press itself (crossfadePair).
      return null;
    case "mute":
      // Bare, so the VERB toggles: two surfaces reading the state and deciding would eventually disagree about it.
      return {
        line: `event status mute ${c.track} ${c.tc}`,
        note: c.muted
          ? m["tool.unmuted"]({ name: c.name })
          : m["tool.muted"]({ name: c.name }),
      };
  }
}

/** What a press on a SHOT knows about it — in seconds, the picture's own unit, since the `picture …` verbs read them. */
export interface ShotTarget {
  lane: string;
  name: string;
  start: number;
  /** Where the shot ends by the picture's rule, Infinity for an open-ended last one. */
  end: number;
  at: number;
}

/** The same tools on a picture lane, each on its `picture …` verb; null leaves the drag underneath to run. */
export function pictureToolLine(tool: Tool, s: ShotTarget): ToolAct {
  const sec = (v: number) => String(Math.round(v * 1000) / 1000);
  switch (tool) {
    case "pointer":
    case "crossfade":
      // A shot's crossfade is its `fadeIn`, which its corner handle already draws.
      return null;
    case "cut":
      if (s.at <= s.start + 1e-3)
        return { note: m["tool.cutAtHead"]({ name: s.name }) };
      if (s.at >= s.end - 1e-3)
        return { note: m["tool.cutAtTail"]({ name: s.name }) };
      return {
        line: `picture split ${s.lane} ${sec(s.start)} ${sec(s.at)}`,
        note: m["tool.cutDone"]({ name: s.name, at: `${sec(s.at)}s` }),
      };
    case "erase":
      return {
        line: `picture delete ${s.lane} ${sec(s.start)}`,
        note: m["tool.erased"]({ name: s.name, track: s.lane }),
      };
    case "mute":
      return { note: m["tool.shotNoMute"]() };
  }
}

/** What a crossfade click makes, beats — a drag sizes it instead. */
export const CROSSFADE_BEATS = 0.5;

/** The two neighbouring events a crossfade press means: the one after on the clip's right half, the one before on its left. */
export function crossfadePair<
  C extends { id: string; start: number; length: number; type: string },
>(clips: readonly C[], c: C, at: number): { a: C; b: C } | null {
  const end = (x: C) => x.start + x.length;
  const audio = clips.filter((x) => x.type === "audio" && x.id !== c.id);
  if (at >= c.start + c.length / 2) {
    const b = audio
      .filter((x) => x.start > c.start)
      .sort((p, q) => p.start - q.start)[0];
    return b ? { a: c, b } : null;
  }
  const a = audio
    .filter((x) => x.start < c.start)
    .sort((p, q) => end(q) - end(p))[0];
  return a ? { a, b: c } : null;
}
