// migrateTimecodes.ts — rewrite a project's timecodes as bar:beat:eighth:sixteenth, anything
// finer as ticks.
//
//   npx tsx packages/song/scripts/migrateTimecodes.ts <project.st0> [--write]
//
// The pressing reason: a SHORT deep chain is legal in both notations and means different things,
// so until a song is converted three of its times are read half a beat from where they were
// written. This reads with the old rule and writes with the new one. Dry by default; the rules
// and their tests are src/timecodeMigrate.ts.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  beatsToPosition,
  parsePosition,
  TICKS_PER_QUARTER,
} from "@studio/song-schema/timecode";
import { TIMECODE } from "@studio/song-schema/yaml/placementSchema";
import { isMap, isScalar, parseDocument } from "yaml";
import { migrateTimecodes } from "../src/timecodeMigrate";

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

/** Marker keys are reported, never rewritten: a KEY is an address, and holders would break. */
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
  // The floor is one tick, so the worst case is half a tick — reported rather than assumed.
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
