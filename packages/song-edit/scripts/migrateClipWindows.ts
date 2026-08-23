/**
 * Move every material's `from`/`to` DOWN onto the placements that play it.
 *
 * After this, `clips/*.yaml` and `sequences/*.yaml` describe the MATERIAL — `source`, `warp`,
 * `onsets`, `notes` — and a placement describes the USE: `start`, `from`, `to`, `loop`, the fades.
 * One level instead of two, which is what `VideoClipSchema` has always been.
 *
 *   npx tsx packages/song-edit/scripts/migrateClipWindows.ts <project.st0> [--write]
 *
 * Dry by default: without `--write` it prints what it would do and touches nothing. The rules and
 * their tests are src/windowDescend.ts.
 *
 * A material NO PLACEMENT references loses its window — a take set aside is not in the song, and
 * re-placing it means gating it again. Every one is named in the report rather than dropped in
 * silence, so nothing goes without being read.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  descendWindows,
  type Grid,
  type MaterialWindow,
  materialWindow,
  stripMaterialWindow,
} from "@studio/song-edit/windowDescend";
import { parseDocument } from "yaml";

/** Not the live song: `_history` holds superseded copies, and the rest is not ours. */
const SKIP_DIRS = new Set(["_history", ".git", "node_modules", "_recycle_bin"]);
/** Where the MATERIALS are. Everything else in the project may hold placements. */
const MATERIAL_DIRS = new Set(["clips", "sequences"]);

function yamlFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) yamlFiles(abs, out);
    else if (name.endsWith(".yaml")) out.push(abs);
  }
  return out;
}

/** The project's grid — a timecode edge means nothing without it, and a clip's seconds need a tempo. */
function gridOf(root: string): Grid {
  const doc = parseDocument(readFileSync(join(root, "project.yaml"), "utf8"), {
    version: "1.2",
  });
  const p = (doc.getIn(["project"]) ?? {}) as Record<string, unknown>;
  const sig = String(doc.getIn(["project", "timeSignature"]) ?? "4/4");
  const [num, den] = sig.split("/").map(Number);
  return {
    tempo: Number(p.tempo ?? 120) || 120,
    num: num || 4,
    den: den || 4,
  };
}

function main(): void {
  const [root, ...rest] = process.argv.slice(2);
  if (!root) {
    console.error(
      "usage: migrateClipWindows.ts <project.st0> [--write]   (dry by default)",
    );
    process.exit(2);
  }
  const write = rest.includes("--write");
  const grid = gridOf(root);

  // --- what each material states -------------------------------------------------
  const windows = new Map<string, { file: string; win: MaterialWindow }>();
  for (const kind of ["clip", "sequence"] as const) {
    const dir = join(root, kind === "clip" ? "clips" : "sequences");
    let names: string[];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith(".yaml"));
    } catch {
      continue; // a project may have neither folder
    }
    for (const name of names) {
      const abs = join(dir, name);
      const win = materialWindow(readFileSync(abs, "utf8"), kind);
      if (win) windows.set(name.replace(/\.yaml$/, ""), { file: abs, win });
    }
  }

  // --- push them onto every placement, wherever it lives ---------------------------
  const placed = new Set<string>();
  const lines: string[] = [];
  let wrote = 0;
  let lanes = 0;
  const intersected: string[] = [];
  for (const abs of yamlFiles(root)) {
    const rel = relative(root, abs).replaceAll("\\", "/");
    if (MATERIAL_DIRS.has(rel.split("/")[0])) continue;
    const before = readFileSync(abs, "utf8");
    const out = descendWindows(
      before,
      (ref) => {
        const hit = windows.get(ref);
        if (hit) placed.add(ref);
        return hit?.win;
      },
      grid,
    );
    intersected.push(...out.intersected);
    if (out.text === before) continue;
    lanes++;
    wrote += out.wrote;
    lines.push(`  ${rel}  ${out.wrote} placement(s)`);
    if (write) writeFileSync(abs, out.text, "utf8");
  }

  // --- and clear the materials ------------------------------------------------------
  const orphans: string[] = [];
  let stripped = 0;
  for (const [ref, { file }] of windows) {
    if (!placed.has(ref)) orphans.push(ref);
    const before = readFileSync(file, "utf8");
    const after = stripMaterialWindow(before);
    if (after === before) continue;
    stripped++;
    if (write) writeFileSync(file, after, "utf8");
  }

  // --- report ------------------------------------------------------------------------
  for (const l of lines.slice(0, 20)) console.log(l);
  if (lines.length > 20) console.log(`  … and ${lines.length - 20} more`);
  console.log(
    `\n${stripped} material(s) cleared, ${wrote} placement(s) written across ${lanes} file(s)` +
      `${write ? " — WRITTEN" : " — dry run, nothing written"}`,
  );
  if (intersected.length)
    console.log(
      `resolved ${intersected.length} event(s) that already stated an edge: ${[...new Set(intersected)].join(", ")}`,
    );
  if (orphans.length) {
    // Named, every one: this is the window the migration DROPS, and the only chance to read it.
    console.log(
      `\n${orphans.length} material(s) no placement references — their window is dropped:`,
    );
    for (const o of orphans) console.log(`  ${o}`);
  }
}

main();
