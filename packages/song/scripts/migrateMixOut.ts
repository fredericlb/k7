// migrateMixOut.ts — point a song's lanes at MIX, and give it the MIX -> OUT run.
//
// `OUT` names the DEVICE and `MIX` is the mixer's sum, so a song wiring its lanes straight to OUT
// says something it does not mean. Every project a scaffold writes declares `MIX: [ OUT ]` — the
// master chain's place, empty — and this adds it to a song that lacks it.
//   npx tsx packages/song/scripts/migrateMixOut.ts <project.k7> [--dry]
// See ../docs/masterChain.md.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2).filter((a) => a !== "--dry");
const dry = process.argv.includes("--dry");
if (args.length === 0) {
  console.error(
    "usage: migrateMixOut.ts <project.k7> [more…] [--dry]\n" +
      "  rewrites each graph.yaml so lanes end at MIX rather than OUT,\n" +
      "  and adds the `MIX: [ OUT ]` run if it has none",
  );
  process.exit(2);
}

/** Rewrite the DESTINATIONS only, textually: re-emitting would reformat a hand-edited file. */
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

/** Append `MIX: [ OUT ]` at the END of the `modules:` map, or null when there is no such key. */
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

    // Step one: the destinations, skipped on a file that already names MIX.
    if (!renamed(text)) {
      const { out, hits } = migrate(text);
      if (hits > 0) {
        text = out;
        said.push(`${hits} destination(s) OUT -> MIX`);
      }
    }

    // Step two, independent of step one: a project migrated earlier would otherwise never get it.
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
