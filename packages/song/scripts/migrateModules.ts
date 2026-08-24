// One-shot: move a WORKSPACE off the generated plugin catalogue.
//
//   npx tsx packages/song/scripts/migrateModules.ts <workspace>
//
// Rewrites every project's modules, purges the wrappers from `_modules` and renames its
// namespace to `library`. Each project's `chains.yaml` is backed up as `.bak` before its
// steps are renamed.

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { renameNode } from "@studio/song-schema/yaml/graphFile";
import { engineModules } from "../src/engineCatalogue";
import {
  DEFAULT_NODE,
  migrateLibrary,
  migrateProjectModules,
} from "../src/moduleMigrate";

const root = process.argv[2];
if (!root) {
  console.error("usage: migrateModules <workspace>");
  process.exit(2);
}
const lib = join(root, "_modules");
const catalogue = engineModules();

// The shared io nodes, read before the folder goes: each belongs to the song that records through it.
const sharedIo = new Map<string, string>();
for (const kind of ["IN", "OUT"]) {
  const dir = join(lib, "io", kind);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir))
    if (/\.ya?ml$/.test(f) && !/^module\.ya?ml$/.test(f))
      sharedIo.set(
        `${kind}:${f.replace(/\.ya?ml$/, "")}`,
        readFileSync(join(dir, f), "utf8"),
      );
}

const projects = readdirSync(root, { withFileTypes: true })
  .filter(
    (e) =>
      e.isDirectory() &&
      !e.name.startsWith("_") &&
      existsSync(join(root, e.name, "project.yaml")),
  )
  .map((e) => e.name);

for (const name of projects) {
  const dir = join(root, name);
  const r = migrateProjectModules(dir, catalogue);
  const lines: string[] = [];
  if (r.changed) {
    for (const m of r.modules) lines.push(`    ${m}`);
    // The chains follow the modules that gained a `default` node.
    const chains = join(dir, "chains.yaml");
    if (r.steps.length && existsSync(chains)) {
      if (!existsSync(`${chains}.bak`)) copyFileSync(chains, `${chains}.bak`);
      let text = readFileSync(chains, "utf8");
      for (const step of r.steps) {
        const [from] = step.split(" -> ");
        text = renameNode(text, from, `${from}:${DEFAULT_NODE}`).text;
      }
      writeFileSync(chains, text, "utf8");
      for (const s of r.steps) lines.push(`    chain: ${s}`);
    }
  }
  // Only the io nodes this project NAMES: a rig had twenty, a song records through one or two.
  const chains = join(dir, "chains.yaml");
  if (existsSync(chains)) {
    let text = readFileSync(chains, "utf8");
    let moved = false;
    for (const [key, body] of sharedIo) {
      const [kind, node] = key.split(":");
      const old = new RegExp(`@[A-Za-z0-9_-]+/io/${kind}:${node}\\b`);
      if (!old.test(text)) continue;
      if (!existsSync(`${chains}.bak`)) copyFileSync(chains, `${chains}.bak`);
      const folder = join(dir, "modules", "io", kind);
      mkdirSync(folder, { recursive: true });
      const path = join(folder, `${node}.yaml`);
      // Without `io: in` written here the node is not an input and its channel is ignored.
      const io = kind === "IN" ? "in" : "out";
      if (!existsSync(path))
        writeFileSync(
          path,
          /^io:/m.test(body) ? body : `io: ${io}\n${body}`,
          "utf8",
        );
      const from = old.exec(text)?.[0] ?? "";
      text = renameNode(text, from, `${kind}:${node}`).text;
      lines.push(`    io: ${from} -> ${kind}:${node}`);
      moved = true;
    }
    if (moved) writeFileSync(chains, text, "utf8");
  }
  for (const n of r.notes) lines.push(`    note: ${n}`);
  for (const e of r.errors) lines.push(`    ! ${e}`);
  console.log(
    `${r.changed ? "MIGRÉ   " : "inchangé"} ${name}${lines.length ? `\n${lines.join("\n")}` : ""}`,
  );
}

// Last, and only after a copy exists: 255 folders go and nothing can regenerate them.
const libBak = `${lib}.bak`;
if (existsSync(lib) && !existsSync(libBak)) {
  cpSync(lib, libBak, { recursive: true });
  console.log(`\n_modules sauvegardé -> ${libBak}`);
}
const l = migrateLibrary(lib);
console.log(
  `\n_modules: ${l.removed.length} supprimés, ${l.kept.length} gardés` +
    (l.kept.length ? ` (${l.kept.join(", ")})` : "") +
    (l.errors.length ? `\n  ! ${l.errors.join("\n  ! ")}` : ""),
);
