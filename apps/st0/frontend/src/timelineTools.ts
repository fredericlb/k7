// timelineTools.ts — what a PRESS on a clip means, which is the tool's axis; the MODE's is where
// the keyboard is (timelineMode.ts). Every tool stands on ONE verb, so a gesture stays one command
// and one Ctrl+Z — which is why there is no pencil here: `event add` places a clip that already
// exists, so drawing one would be `sequence new` and then `event add`, two entries for one gesture.
// See apps/st0/frontend/docs/timeline.md.

/** The pointer is the tool with no verb: it means the grab, the marquee and the caret, as before. */
export const TOOLS = ["pointer", "cut", "erase", "mute"] as const;
export type Tool = (typeof TOOLS)[number];

export const isTool = (s: string): s is Tool =>
  (TOOLS as readonly string[]).includes(s);

/** What each tool does, for the strip's tooltip and its accessible name (docs/timeline.md). */
export const TOOL_LABEL: Record<Tool, string> = {
  pointer: "flèche — prendre, encadrer, poser le curseur",
  cut: "lame — couper l'événement au temps pointé",
  erase: "gomme — retirer l'événement de la voie",
  mute: "muet — faire taire l'événement sans le retirer",
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
          note: `rien à couper : la coupe tombe sur le début de ${c.name}`,
        };
      if (c.length > 0 && c.at >= c.start + c.length - EPS)
        return {
          note: `rien à couper : la coupe tombe sur la fin de ${c.name}`,
        };
      return {
        line: `event split ${c.track} ${c.tc} ${c.atTc}`,
        note: `${c.name} coupé à ${c.atTc}`,
      };
    case "erase":
      return {
        line: `event remove ${c.track} ${c.tc}`,
        note: `${c.name} retiré de ${c.track}`,
      };
    case "mute":
      // Bare, so the VERB toggles: two surfaces reading the state and deciding would eventually disagree about it.
      return {
        line: `event status mute ${c.track} ${c.tc}`,
        note: c.muted ? `${c.name} rendu au son` : `${c.name} fait taire`,
      };
  }
}
