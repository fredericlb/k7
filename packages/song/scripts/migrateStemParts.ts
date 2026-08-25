// migrateStemParts.ts — move a SET's stem knobs from "how much to REMOVE" to "how much to PLAY".
//
//   npx tsx packages/song/scripts/migrateStemParts.ts <projet.st0> [more…] [--write]
//
// `Level` ran −1..1 against a deck that subtracted from the record; it now runs 0..2 against one
// that plays the four PARTS, so the same sound is one higher — −0.6 removed 60% of the drums, 0.4
// plays 40% of them. A set moves only when none of its knobs is above 0, so a second run is a no-op;
// the ambiguous case is in ../docs/setProject.md. Dry by default, through the yaml Document API.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STEM_PARAM, STEMS, stemCut } from "@studio/song-schema/stems";
import { type Document, parseDocument, type YAMLMap } from "yaml";

const OPTS = { version: "1.2" as const, lineWidth: 0 };
const OUT = { lineWidth: 0 };

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error(
    "usage: migrateStemParts <projet.st0> [more…] [--write]   (dry run without --write)",
  );
  process.exit(2);
}

let seen = 0;
let changed = 0;

for (const dir of roots) {
  seen += 1;
  console.log(dir);

  const surfacePath = join(dir, "surfaces", "desk.yaml");
  if (!existsSync(surfacePath)) {
    console.error("  ! no surfaces/desk.yaml — this is not a set");
    continue;
  }
  const sdoc = parseDocument(readFileSync(surfacePath, "utf8"), OPTS);
  const mapping = sdoc.get("mapping") as YAMLMap | undefined;
  const decks = (mapping?.items ?? [])
    .map((i) => String((i.key as { value?: unknown })?.value ?? ""))
    .filter((k) => k.endsWith(".tempo"))
    .map((k) => k.split(".")[0]);
  if (!decks.length) {
    console.error("  ! that surface wires no deck");
    continue;
  }

  // Read the whole set first: ONE knob above 0 means this document already speaks the new range.
  const found: {
    node: string;
    path: string;
    doc: Document;
    params: YAMLMap;
    raw: number;
  }[] = [];
  for (const deck of decks)
    for (const stem of STEMS) {
      const node = stemCut(deck, stem);
      const path = join(dir, "nodes", `${node}.yaml`);
      if (!existsSync(path)) continue;
      const doc = parseDocument(readFileSync(path, "utf8"), OPTS);
      const params = doc.get("params") as YAMLMap | undefined;
      const raw = params?.get(STEM_PARAM);
      if (!params || typeof raw !== "number") continue;
      found.push({ node, path, doc, params, raw });
    }

  if (!found.length || found.some((f) => f.raw > 0)) {
    console.log("  = already playing parts");
    continue;
  }

  const moved: string[] = [];
  for (const f of found) {
    const next = Math.min(2, Math.max(0, f.raw + 1));
    f.params.set(STEM_PARAM, next);
    moved.push(`${f.node}: ${f.raw} → ${next}`);
    if (write) writeFileSync(f.path, f.doc.toString(OUT), "utf8");
  }
  changed += 1;
  for (const m of moved) console.log(`  + ${m}`);
}

console.log(
  `${changed}/${seen} set(s) ${write ? "rewritten" : "would change — pass --write"}`,
);
