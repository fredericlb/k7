// migrateMixOut.ts — point a song's lanes at MIX, and give it the MIX -> OUT run.
//
// `OUT` used to be the only output and meant "the mixer's sum". It now names the DEVICE, and
// `MIX` is the sum, so a run wired to OUT says something it did not mean before. Every project a
// scaffold writes also declares `MIX: [ OUT ]` — the master chain's place, empty — and this adds
// it to the ones written before that.
//   npx tsx packages/song/scripts/migrateMixOut.ts <project.st0> [--dry]
// See ../docs/masterChain.md.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2).filter((a) => a !== "--dry");
const dry = process.argv.includes("--dry");
if (args.length === 0) {
  console.error(
    "usage: migrateMixOut.ts <project.st0> [more…] [--dry]\n" +
      "  rewrites each graph.yaml so lanes end at MIX rather than OUT,\n" +
      "  and adds the `MIX: [ OUT ]` run if it has none",
  );
  process.exit(2);
}

/**
 * Rewrite the DESTINATIONS only, and only where they are the bare word.
 *
 * A textual pass rather than a parse-and-dump, for the reason every writer in this repo gives:
 * a graph.yaml is commented and hand-edited, and re-emitting it would reformat the whole file
 * to change one word. The word boundary is what keeps `OUTRO` and `layout` out of it.
 */
function migrate(text: string): { out: string; hits: number } {
  let hits = 0;
  const out = text.replace(
    // Only inside a destination list — after a `:` and within the brackets, or a `- ` item.
    /(\[[^\]\n]*\]|:\s*OUT\s*$|^\s*-\s*OUT\s*$)/gm,
    (segment) =>
      segment.replace(/\bOUT\b/g, () => {
        hits++;
        return "MIX";
      }),
  );
  return { out, hits };
}

/** Does this project already say MIX anywhere? Then its destinations have been migrated. */
const renamed = (text: string): boolean => /\bMIX\b/.test(text);

/** …and does it declare the run itself — a `MIX:` KEY, not just a destination naming it? */
const hasRun = (text: string): boolean => /^\s*MIX\s*:/m.test(text);

/**
 * Append `MIX: [ OUT ]` to the `modules:` map, after its last entry.
 *
 * Textual for the same reason as above, and placed at the END of the map rather than the top
 * because that is where the signal arrives: a reader following the arrows down the file reaches
 * the sum last. The map's extent is "the indented lines under the key", which is what YAML means
 * by a block mapping — a comment line indented with it belongs to it and is stepped over.
 *
 * Null when there is no `modules:` key at all. That is a graph with no segments, and inventing
 * the map to hold one line would be writing a file the project never had.
 */
function addRun(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^modules\s*:/.test(l));
  if (start === -1) return null;
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    // A blank line inside the block is not the end of it — only the next unindented line is.
    if (lines[i].trim() === "") continue;
    if (!/^\s/.test(lines[i])) break;
    end = i;
  }
  lines.splice(end + 1, 0, "  MIX: [ OUT ]");
  return lines.join("\n");
}

let changed = 0;
for (const project of args) {
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(project);
  } catch {
    console.error(`${project}: not found`);
    process.exitCode = 1;
    continue;
  }
  // A folder of projects is as ordinary an argument as one project — `songs/` holds several.
  const dirs = st.isDirectory()
    ? readdirSync(project).some((f) => f === "graph.yaml")
      ? [project]
      : readdirSync(project)
          .map((f) => join(project, f))
          .filter((p) => {
            try {
              return statSync(p).isDirectory();
            } catch {
              return false;
            }
          })
    : [];

  for (const dir of dirs) {
    const file = join(dir, "graph.yaml");
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const said: string[] = [];

    // Step one: the destinations. Skipped on a file that already names MIX — it was migrated, or
    // was written after the split.
    if (!renamed(text)) {
      const { out, hits } = migrate(text);
      if (hits > 0) {
        text = out;
        said.push(`${hits} destination(s) OUT -> MIX`);
      }
    }

    // Step two: the run out of the sum. Independent of step one, deliberately — a project
    // migrated before this line existed passes the guard above and would otherwise never get it.
    if (!hasRun(text)) {
      const withRun = addRun(text);
      if (withRun === null) said.push("no `modules:` map — left alone");
      else {
        text = withRun;
        said.push("added MIX: [ OUT ]");
      }
    }

    if (!said.length) {
      console.log(`${file}: nothing to do`);
      continue;
    }
    console.log(`${file}: ${said.join(", ")}${dry ? " (dry)" : ""}`);
    // "left alone" is the one thing said that is not a change to write.
    if (said.some((s) => s.startsWith("no `modules:`")) && said.length === 1)
      continue;
    if (!dry) writeFileSync(file, text, "utf8");
    changed++;
  }
}
console.log(
  dry ? `${changed} file(s) would change` : `${changed} file(s) rewritten`,
);
