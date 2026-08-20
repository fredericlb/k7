/**
 * Rewrite a project's timecodes as MESURE:NOIRE:CROCHE:DOUBLECROCHE, with anything finer as ticks.
 *
 * Two reasons, and the second is the pressing one. A file full of `to: "5:3:3:4:1:2:3:3"` is a
 * place value nobody can read; and a SHORT deep chain is legal in the new notation while meaning
 * something else in it, so until a song is converted, three of its times are read half a beat from
 * where they were written. This reads with the old rule and writes with the new one.
 *
 *   npx tsx packages/song/scripts/migrateTimecodes.ts <project.st0> [--write]
 *
 * Dry by default: without `--write` it prints what it would do and touches nothing. The rewriting
 * itself is src/timecodeMigrate.ts, which is where the rules and their tests live.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isMap, isScalar, parseDocument } from "yaml";
import {
  beatsToPosition,
  parsePosition,
  TICKS_PER_QUARTER,
} from "../src/timecode";
import { migrateTimecodes } from "../src/timecodeMigrate";
import { TIMECODE } from "../src/yaml/placementSchema";

/** Directories whose contents are not the live song. `_history` holds superseded copies. */
const SKIP_DIRS = new Set(["_history", ".git", "node_modules"]);

function yamlFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) yamlFiles(abs, out);
    else if (name.endsWith(".yaml")) out.push(abs);
  }
  return out;
}

/** The project's time signature — the whole conversion is relative to it. */
function meter(root: string): { num: number; den: number } {
  const doc = parseDocument(readFileSync(join(root, "project.yaml"), "utf8"), {
    version: "1.2",
  });
  const sig = String(doc.getIn(["project", "timeSignature"]) ?? "4/4");
  const [n, d] = sig.split("/").map((x) => Number.parseInt(x, 10));
  return {
    num: Number.isFinite(n) && n > 0 ? n : 4,
    den: Number.isFinite(d) && d > 0 ? d : 4,
  };
}

/**
 * Marker keys that would also shorten — reported, never rewritten.
 *
 * A marker is a MAP KEY, so changing it is not editing a value but moving the label to another
 * address, and anything holding a marker by its key would be pointing at nothing. They are also
 * where a v1 project keeps WALL-CLOCK positions, which are not this notation at all.
 */
function deepMarkers(root: string, num: number, den: number): string[] {
  const doc = parseDocument(readFileSync(join(root, "project.yaml"), "utf8"), {
    version: "1.2",
  });
  const markers = doc.get("markers", true);
  if (!isMap(markers)) return [];
  const odd: string[] = [];
  for (const p of markers.items) {
    const k = isScalar(p.key) ? String(p.key.value) : "";
    if (!TIMECODE.test(k)) continue;
    try {
      if (beatsToPosition(parsePosition(k, num, den), num, den) !== k)
        odd.push(k);
    } catch {
      /* unreadable: leave it, and claim nothing about it */
    }
  }
  return odd;
}

function main(): void {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const root = args.find((a) => !a.startsWith("--"));
  if (!root) {
    console.error("usage: migrateTimecodes.ts <project.st0> [--write]");
    process.exit(2);
  }
  const { num, den } = meter(root);
  let total = 0;
  let touched = 0;
  let worst = 0;
  const lines: string[] = [];
  for (const abs of yamlFiles(root)) {
    const before = readFileSync(abs, "utf8");
    const { text, changes } = migrateTimecodes(before, num, den);
    if (!changes.length) continue;
    touched++;
    total += changes.length;
    const rel = relative(root, abs).replaceAll("\\", "/");
    for (const c of changes) {
      worst = Math.max(worst, c.driftBeats);
      lines.push(`  ${rel}  ${c.key}: "${c.from}" -> "${c.to}"`);
    }
    if (write) writeFileSync(abs, text);
  }
  for (const l of lines.slice(0, 20)) console.log(l);
  if (lines.length > 20) console.log(`  … and ${lines.length - 20} more`);
  console.log(
    `\n${total} timecode(s) in ${touched} file(s), ${num}/${den}${write ? " — WRITTEN" : " — dry run, nothing written"}`,
  );
  // The short form's floor is one tick (1/960 of a quarter); a deep chain could name a moment
  // between two of them, so the worst case is half a tick, reported rather than assumed.
  console.log(
    `worst rounding: ${worst.toFixed(9)} beats (${(worst * TICKS_PER_QUARTER).toFixed(4)} ticks)`,
  );
  const odd = deepMarkers(root, num, den);
  if (odd.length)
    console.log(
      `NOTE: ${odd.length} marker key(s) could also shorten (${odd.join(", ")}) — a marker is a map KEY, so this script leaves them.`,
    );
}

main();
