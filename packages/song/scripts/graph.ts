// scripts/graph.ts — `k7 graph <project> [track]`: a project's chains, tracks and warnings, as text.

import { resolve } from "node:path";
import {
  describeGraph,
  describeTrackGraph,
  type GraphDoc,
  loadGraph,
  resolveTrack,
} from "../src/graph";

function main(): void {
  // Positionals: <project> [trackname]; a trackname narrows the display to that track's chains.
  const [projectArg, trackArg] = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("-"));
  if (!projectArg) {
    console.error("usage: k7 graph <project> [trackname]");
    process.exit(2);
  }
  let g: GraphDoc;
  try {
    g = loadGraph(resolve(projectArg));
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  }
  console.log(
    `${g.project.name}  (${g.project.tempo} bpm, ${g.project.timeSignature})`,
  );
  console.log(
    `  ${Object.keys(g.chains).length} chains · ${Object.keys(g.tracks).length} tracks · ` +
      `${Object.keys(g.modules).length} modules`,
  );
  console.log("");

  if (trackArg) {
    const id = resolveTrack(g, trackArg);
    if (!id) {
      console.error(
        `  no track matching '${trackArg}' (tracks: ${Object.keys(g.tracks).join(", ") || "none"})`,
      );
      process.exit(1);
    }
    console.log(`  chains for track '${id}':`);
    for (const line of describeTrackGraph(g, id)) console.log(`  ${line}`);
  } else {
    for (const line of describeGraph(g)) console.log(`  ${line}`);
  }

  if (g.warnings.length) {
    console.log("");
    console.warn(`  ${g.warnings.length} warning(s):`);
    for (const w of g.warnings) console.warn(`    ! ${w}`);
  }
}

main();
