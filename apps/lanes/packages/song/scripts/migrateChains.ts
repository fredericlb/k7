// One-shot: migrate every chains.yaml under the given roots into the segments format.
// Each file is backed up beside itself as chains.yaml.bak before being rewritten.
//
//   npx tsx packages/song/scripts/migrateChains.ts <root> [root…]

import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { migrateChains } from "../src/chainsMigrate";

const roots = process.argv.slice(2);
if (!roots.length) {
  console.error("usage: migrateChains <root> [root…]");
  process.exit(2);
}

const found: string[] = [];
const walk = (dir: string, depth: number): void => {
  if (depth > 6) return;
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as never;
  } catch {
    return;
  }
  for (const e of entries as unknown as {
    name: string;
    isDirectory(): boolean;
  }[]) {
    if (e.name === "node_modules" || e.name.startsWith(".git")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, depth + 1);
    else if (e.name === "chains.yaml") found.push(p);
  }
};
for (const r of roots) if (statSync(r, { throwIfNoEntry: false })) walk(r, 0);

let migrated = 0;
for (const f of found) {
  if (!existsSync(`${f}.bak`)) copyFileSync(f, `${f}.bak`);
  const r = migrateChains(dirname(f));
  if (r.changed) migrated++;
  console.log(
    `${r.changed ? "MIGRATED" : "skipped "} ${f}` +
      (r.split.length
        ? `\n    split: ${r.split.map((s) => `${s.module} -> ${s.instances.join(", ")}`).join(" | ")}`
        : "") +
      (r.created.length ? `\n    created: ${r.created.join(", ")}` : "") +
      (r.notes.length ? `\n    notes: ${r.notes.join("; ")}` : "") +
      (r.errors.length ? `\n    ERRORS: ${r.errors.join("; ")}` : ""),
  );
}
console.log(`\n${migrated} migrated / ${found.length} found`);
