// pendingEdits.ts — what a one-shot timeline command DOES, read off its LINE, so the lanes show it the
// moment it is sent rather than when the new project arrives: a removal hides, a mute dims, a split
// shows its seam, a range move shifts. A refused line takes it back; the next document makes it true.
// Drags need none of this — they hold their own result until the reload. See docs/timeline.md.

import { parseDuration, parsePosition } from "@studio/song-schema/timecode";

/** One event, as the lines name it: its lane and the beat it starts on. */
export const eventKey = (track: string, startBeats: number): string =>
  `${track}@${Math.round(startBeats * 1e6)}`;

/** What a sent line is expected to do to the lanes, until the document says so itself. */
export type PendingEdit =
  | { kind: "hide"; key: string }
  | { kind: "mute"; key: string; on: boolean | null }
  | { kind: "split"; key: string; at: number }
  | { kind: "fade"; key: string; which: "fadeIn" | "fadeOut"; length: number }
  | { kind: "warp"; key: string; on: boolean | null }
  | {
      kind: "shift";
      /** The lanes it moves, null for all of them. */
      tracks: string[] | null;
      from: number;
      to: number;
      by: number;
    };

/** The edits `line` makes — none for any other verb, or for a line that does not parse. */
export function pendingOf(
  line: string,
  num: number,
  den: number,
): PendingEdit[] {
  const s = line.trim();
  const at = (tc: string) => parsePosition(tc, num, den);
  try {
    let m = /^event remove (\S+) (\S+)$/.exec(s);
    if (m) return [{ kind: "hide", key: eventKey(m[1], at(m[2])) }];
    m = /^events remove (\[.*\])$/.exec(s);
    if (m)
      return (JSON.parse(m[1]) as { track?: unknown; start?: unknown }[])
        .filter(
          (e) => typeof e.track === "string" && typeof e.start === "string",
        )
        .map((e) => ({
          kind: "hide" as const,
          key: eventKey(e.track as string, at(e.start as string)),
        }));
    m = /^event status mute (\S+) (\S+)(?: (on|off|toggle))?$/.exec(s);
    if (m)
      return [
        {
          kind: "mute",
          key: eventKey(m[1], at(m[2])),
          on: m[3] === "on" ? true : m[3] === "off" ? false : null,
        },
      ];
    m = /^event status warp (\S+) (\S+)(?: (on|off|toggle))?$/.exec(s);
    if (m)
      return [
        {
          kind: "warp",
          key: eventKey(m[1], at(m[2])),
          on: m[3] === "on" ? true : m[3] === "off" ? false : null,
        },
      ];
    // The crossfade's two fades — its overlap is the server's to find, and arrives with the document.
    m = /^event crossfade (\S+) (\S+) (\S+) (\S+)$/.exec(s);
    if (m) {
      const length = m[4] === "0" ? 0 : parseDuration(m[4], num, den);
      return [
        {
          kind: "fade",
          key: eventKey(m[1], at(m[2])),
          which: "fadeOut",
          length,
        },
        {
          kind: "fade",
          key: eventKey(m[1], at(m[3])),
          which: "fadeIn",
          length,
        },
      ];
    }
    m = /^event split (\S+) (\S+) (\S+)$/.exec(s);
    if (m)
      return [{ kind: "split", key: eventKey(m[1], at(m[2])), at: at(m[3]) }];
    m = /^events move (\S+) (\S+) (\S+) ([+-]?)(\S+)$/.exec(s);
    if (m)
      return [
        {
          kind: "shift",
          tracks: m[1] === "all" ? null : m[1].split(","),
          from: at(m[2]),
          to: at(m[3]),
          by: (m[4] === "-" ? -1 : 1) * parseDuration(m[5], num, den),
        },
      ];
  } catch {
    /* a line that does not parse changes nothing here: the command will say why */
  }
  return [];
}

/** A lane's clips as the pending edits leave them: hidden ones gone, a mute flipped, a range moved. */
export function pendingClips<
  C extends {
    start: number;
    disabled?: boolean;
    fadeIn?: number;
    fadeOut?: number;
    warpOff?: boolean;
  },
>(track: string, clips: readonly C[], edits: readonly PendingEdit[]): C[] {
  if (!edits.length) return clips as C[];
  const out: C[] = [];
  for (const c of clips) {
    const key = eventKey(track, c.start);
    if (edits.some((e) => e.kind === "hide" && e.key === key)) continue;
    let next = c;
    for (const e of edits) {
      if (e.kind === "mute" && e.key === key)
        next = { ...next, disabled: e.on ?? !next.disabled };
      if (e.kind === "fade" && e.key === key)
        next = { ...next, [e.which]: e.length || undefined };
      // `on` follows the map; the clip's flag is the opposite one, that it is declined.
      if (e.kind === "warp" && e.key === key)
        next = { ...next, warpOff: e.on === null ? !next.warpOff : !e.on };
      if (
        e.kind === "shift" &&
        (e.tracks === null || e.tracks.includes(track)) &&
        c.start >= e.from - 1e-6 &&
        c.start <= e.to + 1e-6
      )
        next = { ...next, start: next.start + e.by };
    }
    out.push(next);
  }
  return out;
}

/** Where a pending split cuts the event starting at `start` on `track`, if one does. */
export function pendingSplitAt(
  track: string,
  start: number,
  edits: readonly PendingEdit[],
): number | undefined {
  const key = eventKey(track, start);
  for (const e of edits) if (e.kind === "split" && e.key === key) return e.at;
  return undefined;
}
