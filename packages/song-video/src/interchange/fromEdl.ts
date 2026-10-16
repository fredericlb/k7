// fromEdl.ts — a CMX 3600 EDL read into a one-track cut: an event per cut, a dissolve pair as the
// incoming shot's fade, an M2 line as a speed, a `FROM CLIP NAME` comment as the media's name
// (the reel being too short to say which file). Record timecodes are measured from the EDL's
// first event, so a cut conformed at 01:00:00:00 lands at 0. See docs/interchange.md.

import type { ImportedCut, ImportedShot } from "./imported";

// `HH:MM:SS:FF` (or `;` before the frames, a drop-frame spelling read the same) as seconds at `fps`.
function tc(s: string, fps: number): number | null {
  const m = /^(\d{2}):(\d{2}):(\d{2})[:;.](\d{2})$/.exec(s);
  if (!m) return null;
  return (
    Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / fps
  );
}

const EVENT =
  /^(\d{3,})\s+(\S+)\s+(\S+)\s+(C|D|W\d+)\s*(\d+)?\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/;

/** Read an EDL's text at `fps` (an EDL does not state its rate) into a cut of one track. */
export function fromEdl(text: string, fps: number): ImportedCut {
  let title = "cut";
  const shots: ImportedShot[] = [];
  const skipped: string[] = [];
  let recordZero: number | null = null;
  // A dissolve's first line is the outgoing source, zero long; the line after it is the shot.
  let held = false;
  let last: ImportedShot | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("TITLE:")) title = line.slice(6).trim() || title;
    const clip = /^\*\s*(?:FROM|TO) CLIP NAME:\s*(.+)$/.exec(line);
    if (clip && last) {
      // A dissolve pair names both; the TO name is the incoming shot's, which is the one just read.
      if (line.includes("TO CLIP NAME") || !last.media)
        last.media = (clip[1] as string).trim();
      continue;
    }
    const m2 = /^M2\s+\S+\s+(-?[\d.]+)\s+(\S+)/.exec(line);
    if (m2 && last) {
      last.speed = Number(m2[1]) / fps;
      continue;
    }
    const e = EVENT.exec(line);
    if (!e) continue;
    const [, , , track, kind, frames, srcIn, srcOut, recIn, recOut] = e;
    if (!(track as string).startsWith("V")) {
      skipped.push(`event ${e[1]}: track ${track} — only the picture is read`);
      continue;
    }
    const sIn = tc(srcIn as string, fps);
    const sOut = tc(srcOut as string, fps);
    const rIn = tc(recIn as string, fps);
    const rOut = tc(recOut as string, fps);
    if (sIn === null || sOut === null || rIn === null || rOut === null) {
      skipped.push(`event ${e[1]}: a timecode this cannot read`);
      continue;
    }
    recordZero ??= rIn;
    // The zero-long outgoing line of a dissolve pair: no shot of its own.
    if (kind === "C" && rOut === rIn) {
      held = true;
      continue;
    }
    const shot: ImportedShot = {
      name: `shot-${shots.length + 1}`,
      media: "",
      start: rIn - recordZero,
      length: rOut - rIn,
      sourceFrom: sIn,
    };
    if (kind === "D" && held) {
      // A CMX dissolve begins AT the incoming record in-point, so it is this app's fade as written.
      shot.fadeIn = Number(frames ?? 0) / fps;
      if (last) last.length += shot.fadeIn;
    } else if ((kind as string).startsWith("W"))
      skipped.push(`event ${e[1]}: a wipe — read as a cut`);
    held = false;
    shots.push(shot);
    last = shot;
  }
  shots.forEach((s, i) => {
    s.name = s.media.replace(/\.[^.]+$/, "") || `shot-${i + 1}`;
  });
  return { name: title, fps, tracks: [{ name: "edl", shots }], skipped };
}
