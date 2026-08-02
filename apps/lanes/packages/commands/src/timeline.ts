// timeline.ts — print a project's arrangement: every track and the clips on it, the
// read-only counterpart to the web Timeline tab and the sibling of `inspect graph` (which
// shows ROUTING rather than what's ARRANGED). describeTimeline is pure — a doc in, strings
// out — so the CLI entry and the `timeline.inspect` command render the identical thing.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadProject,
  type ProjectDoc,
  type TrackDoc,
} from "@lanes/song/project";
import { beatsToDuration, beatsToPosition } from "@lanes/song/timecode";

// --- describe (pure) ---------------------------------------------------------

// Beats back into "bar:beat:sub", or you would translate them by hand to find the clip in a file.
const at = (beats: number, num: number, den: number): string =>
  beatsToPosition(beats, num, den);
const len = (beats: number, num: number, den: number): string =>
  beatsToDuration(beats, num, den);

// One clip: where, how long, what it holds. Length 0 is the source's natural length, worth saying outright.
function clipLine(
  c: TrackDoc["clips"][number],
  num: number,
  den: number,
): string {
  const span =
    c.length > 0
      ? `${at(c.start, num, den)} +${len(c.length, num, den)}`
      : `${at(c.start, num, den)} (natural)`;
  const what =
    c.type === "midi"
      ? `midi · ${c.notes.length} note${c.notes.length === 1 ? "" : "s"}`
      : `audio · ${c.source ? c.source.replace(/^.*[\\/]/, "") : "(no source)"}`;
  return `${(c.name || c.id || "(unnamed)").padEnd(16)} ${span.padEnd(18)} ${what}`;
}

// One track and its clips. Flags that change what you'd hear are called out, and a clipless track says so
// rather than rendering as a bare header you would mistake for a group.
export function describeTrack(t: TrackDoc, num: number, den: number): string[] {
  const flags = [
    t.mute ? "muted" : "",
    t.solo ? "solo" : "",
    t.disabled ? "disabled" : "",
  ].filter(Boolean);
  const plugins = t.plugins.length
    ? ` · ${t.plugins.map((p) => p.name).join(" -> ")}`
    : "";
  const head =
    `${t.name || t.id}  [${t.contentType}]` +
    (flags.length ? ` (${flags.join(", ")})` : "") +
    plugins;
  if (t.generated) return [head, "  (generated live by an algo pattern)"];
  if (!t.clips.length) return [head, "  (empty)"];
  return [
    head,
    ...[...t.clips]
      .sort((a, b) => a.start - b.start)
      .map((c) => `  ${clipLine(c, num, den)}`),
  ];
}

// The whole arrangement, clustered like the web timeline (see web/frontend/src/rows.ts), so both surfaces
// describe one project alike. A dangling `group` shows as ungrouped: print what the song has.
export function describeTimeline(p: ProjectDoc): string[] {
  const num = p.timeSigNumerator;
  const den = p.timeSigDenominator;
  const lines: string[] = [];
  const shown = new Set<string>();

  for (const g of p.groups) {
    const members = p.tracks.filter((t) => t.group === g.id);
    const flags = [g.mute ? "muted" : "", g.solo ? "solo" : ""].filter(Boolean);
    lines.push(`${g.id}  (${["group", ...flags].join(", ")})`);
    // A group's undeclared strudel lanes are minted as the transport rolls, so it can read empty and still fill up.
    if (!members.length) lines.push("  (no tracks)");
    for (const t of members) {
      shown.add(t.id);
      for (const l of describeTrack(t, num, den)) lines.push(`  ${l}`);
    }
  }
  for (const t of p.tracks)
    if (!shown.has(t.id)) lines.push(...describeTrack(t, num, den));

  return lines.length ? lines : ["(no tracks)"];
}

// --- cli ---------------------------------------------------------------------

function main(): void {
  // Positionals: <project> [trackname] — mirroring `lanes project inspect graph`.
  const [projectArg, trackArg] = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("-"));
  if (!projectArg) {
    console.error(
      "usage: lanes project inspect timeline <project> [trackname]",
    );
    process.exit(2);
  }
  let p: ProjectDoc;
  try {
    p = loadProject(resolve(projectArg));
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  }

  const clips = p.tracks.reduce((n, t) => n + t.clips.length, 0);
  console.log(
    `${p.name}  (${p.tempo} bpm, ${p.timeSigNumerator}/${p.timeSigDenominator})`,
  );
  console.log(
    `  ${p.tracks.length} track${p.tracks.length === 1 ? "" : "s"} · ` +
      `${p.groups.length} group${p.groups.length === 1 ? "" : "s"} · ` +
      `${clips} clip${clips === 1 ? "" : "s"}`,
  );
  console.log("");

  if (trackArg) {
    const t = p.tracks.find((x) => x.id === trackArg || x.name === trackArg);
    if (!t) {
      console.error(
        `  no track matching '${trackArg}' (tracks: ${p.tracks.map((x) => x.id).join(", ") || "none"})`,
      );
      process.exit(1);
    }
    for (const line of describeTrack(
      t,
      p.timeSigNumerator,
      p.timeSigDenominator,
    ))
      console.log(`  ${line}`);
  } else {
    for (const line of describeTimeline(p)) console.log(`  ${line}`);
  }
}

// Entry-point guard: the filename check stops main() firing when this module is bundled into another entry.
if (
  process.argv[1] &&
  import.meta.url.endsWith("/timeline.ts") &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  main();
