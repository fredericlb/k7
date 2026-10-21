// webNest.ts — a TIMELINE placed as one event, as ONE clip for the surfaces: the engine plays the
// clips it expands into, but the timeline moves, selects, copies and opens the EVENT. Its clips
// ride inside it for drawing. What would be got wrong: the folded clip's length is the timeline's,
// fixed, never the span of what it holds. See @studio/song docs/timelines.md.

import type { TrackDoc } from "@studio/song/project";
import type { WebClip } from "@studio/web-protocol";

type Clip = TrackDoc["clips"][number];

/** The lane's clips as the browser reads them, each timeline event's folded into one clip carrying them. */
export function foldNests(
  clips: Clip[],
  web: (c: Clip) => WebClip,
  fold: (clips: WebClip[]) => WebClip[],
): WebClip[] {
  const out: WebClip[] = [];
  const hosts = new Map<string, { host: WebClip; inner: WebClip[] }>();
  for (const c of clips) {
    if (!c.nest) {
      out.push(web(c));
      continue;
    }
    const n = c.nest;
    let at = hosts.get(n.of);
    if (!at) {
      const host: WebClip = {
        id: n.of,
        type: "audio",
        name: n.ref,
        start: n.start,
        length: n.length,
        ...(n.event?.disabled ? { disabled: true } : {}),
        event: n.event ?? {},
        timeline: { ref: n.ref, clips: [] },
        notes: [],
      };
      at = { host, inner: [] };
      hosts.set(n.of, at);
      out.push(host);
    }
    const { nest: _n, ...own } = c;
    at.inner.push(web(own));
  }
  for (const { host, inner } of hosts.values()) {
    const folded = fold(inner);
    // MIDI only when all it holds is: the lane's colour for audio is the safer guess for a mix.
    if (folded.length && folded.every((c) => c.type === "midi"))
      host.type = "midi";
    host.timeline = { ref: host.timeline?.ref ?? host.name, clips: folded };
  }
  return fold(out);
}
