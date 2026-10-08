// webComp.ts — a comped event as ONE clip for the surfaces: the engine plays its pieces, but the
// timeline moves, selects, copies and opens the EVENT, by the start its placement has. The pieces
// ride inside it for drawing. What would be got wrong: the folded clip's id is the EVENT's, which is
// also its first piece's — a waveform asked for by it is that piece's alone. See song docs/takes.md.

import type { WebClip } from "@studio/web-protocol";

/** The lane's clips with each comped event's pieces folded into one clip spanning them. */
export function foldComps(clips: WebClip[]): WebClip[] {
  const groups = new Map<string, WebClip[]>();
  for (const c of clips)
    if (c.comp) groups.set(c.comp.of, [...(groups.get(c.comp.of) ?? []), c]);
  if (!groups.size) return clips;
  const out: WebClip[] = [];
  const done = new Set<string>();
  for (const c of clips) {
    if (!c.comp) {
      out.push(c);
      continue;
    }
    const of = c.comp.of;
    if (done.has(of)) continue;
    done.add(of);
    const pieces = [...(groups.get(of) ?? [])].sort(
      (a, b) => a.start - b.start,
    );
    const first = pieces[0];
    const last = pieces.reduce((m, p) =>
      p.start + p.length > m.start + m.length ? p : m,
    );
    // The event starts where its placement does: a comp never starts before it (takeFile.ts).
    const at = Number(of.slice(of.lastIndexOf("@") + 1));
    const start = Number.isFinite(at) ? at : first.start;
    out.push({
      id: of,
      type: first.type,
      name: of.slice(0, of.lastIndexOf("@")),
      start,
      length: last.start + last.length - start,
      ...(first.fadeIn ? { fadeIn: first.fadeIn } : {}),
      ...(last.fadeOut ? { fadeOut: last.fadeOut } : {}),
      ...(pieces.some((p) => p.disabled) ? { disabled: true } : {}),
      event: pieces.find((p) => p.event)?.event,
      comp: { of, take: "" },
      pieces,
      notes: [],
    });
  }
  return out;
}
