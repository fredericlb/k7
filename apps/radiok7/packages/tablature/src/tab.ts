// Parses the common ASCII guitar-tab format (e|--0--2--3--|) into a structured
// model the SVG renderer can draw. Because ASCII tab is monospace-aligned, a
// character's column index maps directly to an x position.
//
// Pure and framework-free (mirrors @radiok7/lyrics' chordSheet) so it can be
// unit-tested.

export interface TabEvent {
  col: number;
  text: string;
  kind: "fret" | "technique";
}

export interface TabString {
  label: string;
  events: TabEvent[];
}

export type TabNode =
  | { type: "empty" }
  | { type: "section"; label: string }
  | { type: "text"; text: string }
  | { type: "system"; strings: TabString[]; bars: number[]; cols: number };

// Characters that may appear in tab content (after an optional string label):
// dashes, bar lines, digits, whitespace, and the common technique letters —
// h/p (hammer/pull), b/r (bend/release), s (slide), t (tap), v (vibrato),
// g (grace/legato), l/L (let ring), x (dead note), o (harmonic), plus symbols.
const TAB_BODY = /^[-|0-9\shHpPbBrRsStTvVgGlLxXoO/\\~^()*.=<>]+$/;
// Leading string label like "e", "B", "A#". The `|` that usually follows is left
// in the body so it renders as a start-of-measure bar line at column 0.
const LABEL = /^\s*([A-Ga-g][#b]?)?\s*/;
// Whole-line section label (mirrors chordSheet's section detection).
const BRACKET_SECTION = /^\s*[[({]\s*([^\])}]+?)\s*[\])}]\s*$/;
const COLON_SECTION = /^\s*([A-Za-z][\w '#/-]*?):\s*$/;

/** True if a line reads as one string of an ASCII tab (mostly dashes/frets). */
export function looksLikeTabLine(line: string): boolean {
  const body = line.replace(LABEL, "");
  if (!TAB_BODY.test(body)) return false;
  const nonSpace = body.replace(/\s/g, "");
  const dashes = (body.match(/-/g) ?? []).length;
  return dashes >= 3 && dashes / Math.max(nonSpace.length, 1) >= 0.3;
}

// Extract the string label and the column where tab content starts, so bodies
// across a system align on the same column grid.
function splitLabel(line: string): { label: string; bodyStart: number } {
  const m = LABEL.exec(line);
  const raw = m ? m[0] : "";
  return { label: raw.replace(/\s+/g, ""), bodyStart: raw.length };
}

function parseStringLine(
  line: string,
  bodyStart: number,
): { events: TabEvent[]; bars: number[] } {
  const events: TabEvent[] = [];
  const bars: number[] = [];
  let i = bodyStart;
  while (i < line.length) {
    const ch = line[i];
    const col = i - bodyStart;
    if (ch === "-" || ch === " ") {
      i += 1;
    } else if (ch === "|") {
      bars.push(col);
      i += 1;
    } else if (ch >= "0" && ch <= "9") {
      // Group consecutive digits into a single multi-digit fret number.
      let j = i + 1;
      while (j < line.length && line[j] >= "0" && line[j] <= "9") j += 1;
      events.push({ col, text: line.slice(i, j), kind: "fret" });
      i = j;
    } else {
      events.push({ col, text: ch, kind: "technique" });
      i += 1;
    }
  }
  return { events, bars };
}

function buildSystem(lines: string[]): Extract<TabNode, { type: "system" }> {
  const bodyStart = Math.max(...lines.map((l) => splitLabel(l).bodyStart));
  const strings: TabString[] = [];
  const barSet = new Set<number>();
  let cols = 0;
  for (const line of lines) {
    const { label } = splitLabel(line);
    const { events, bars } = parseStringLine(line, bodyStart);
    strings.push({ label, events });
    for (const b of bars) barSet.add(b);
    cols = Math.max(cols, line.length - bodyStart);
  }
  return {
    type: "system",
    strings,
    bars: [...barSet].sort((a, b) => a - b),
    cols,
  };
}

/**
 * Split raw tab text into classified nodes.
 *
 * A system is a maximal run of consecutive string lines; blank or non-tab lines
 * end it. Label-based splitting is deliberately avoided: standard tuning labels
 * both the 1st and 6th string `E`, so a repeated-label rule would chop the last
 * string into its own system. (Trade-off: two systems with no blank line between
 * them merge into one tall block — rare, since tab exports blank-separate them.)
 */
export function parseTablature(text: string): TabNode[] {
  const lines = text.split(/\r?\n/);
  const nodes: TabNode[] = [];
  let run: string[] = [];

  const flush = () => {
    if (run.length) {
      nodes.push(buildSystem(run));
      run = [];
    }
  };

  for (const line of lines) {
    if (looksLikeTabLine(line)) {
      run.push(line);
      continue;
    }
    flush();
    if (line.trim() === "") {
      nodes.push({ type: "empty" });
      continue;
    }
    const bracket = BRACKET_SECTION.exec(line);
    const colon = COLON_SECTION.exec(line);
    if (bracket) nodes.push({ type: "section", label: bracket[1] });
    else if (colon) nodes.push({ type: "section", label: colon[1] });
    else nodes.push({ type: "text", text: line });
  }
  flush();
  return nodes;
}
