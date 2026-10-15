// captions.ts — a subtitle file, `.srt` or WebVTT, read into timed cues in seconds from the file's
// own zero: the clip's material, which a placement then puts on the timeline as it puts a shot.
// One reader for both, since a cue is the same three things in each and only the punctuation
// differs. Markup is stripped, since a cue is drawn as plain lines. See docs/titles.md.

/** One cue: when it shows and when it goes, in seconds of the file, and its lines. */
export interface CueDoc {
  start: number;
  end: number;
  text: string;
}

// `01:02:03,456`, `02:03.456` or `02:03` — hours optional, a comma or a point before the fraction.
const TIME = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/;

function seconds(s: string): number | null {
  const m = TIME.exec(s.trim());
  if (!m) return null;
  const frac = m[4] ? Number(m[4].padEnd(3, "0")) / 1000 : 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac;
}

/** The cues of `text`, in file order, and the blocks that could not be read — never a throw. */
export function parseCaptions(text: string): {
  cues: CueDoc[];
  problems: string[];
} {
  const cues: CueDoc[] = [];
  const problems: string[] = [];
  const blocks = text.replace(/^﻿/, "").split(/\r?\n\s*\r?\n/);
  blocks.forEach((block, i) => {
    const lines = block.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (!lines.length) return;
    // WebVTT's header, its NOTE and STYLE blocks carry no cue.
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0] as string)) return;
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) {
      problems.push(`block ${i + 1}: no timing line`);
      return;
    }
    const [from = "", rest = ""] = (lines[at] as string).split("-->");
    // A VTT timing line may carry cue settings after the end time; they are the renderer's to ignore.
    const start = seconds(from);
    const end = seconds(rest.trim().split(/\s+/)[0] ?? "");
    if (start === null || end === null || !(end > start)) {
      problems.push(
        `block ${i + 1}: cannot read '${(lines[at] as string).trim()}'`,
      );
      return;
    }
    const body = lines
      .slice(at + 1)
      .map((l) => l.replace(/<[^>]*>/g, "").trim())
      .join("\n");
    if (body) cues.push({ start, end, text: body });
  });
  return { cues, problems };
}
