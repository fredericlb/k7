#!/usr/bin/env node
// check-changed.mjs — `npm run check:changed`: biome, the blocking repo lints, then typecheck + test
// of only the workspaces the branch touches, against its merge-base with `win/main` (else `main`).
// `--dependents` adds every workspace that depends on a touched one; `--base <ref>`, `--jobs N`, `--dry`.
// A file outside every workspace (root config, docs/) runs the lints only; why: docs/agents.md.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import concurrently from "concurrently";

const args = process.argv.slice(2);
const opt = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const jobs = Number(opt("--jobs") ?? 2);
const dry = args.includes("--dry");
const LINTED = /\.(?:[cm]?[jt]sx?|jsonc?)$/;

function sh(cmd, argv) {
  const r = spawnSync(cmd, argv, { encoding: "utf8", maxBuffer: 64 << 20 });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

const ref =
  opt("--base") ??
  ["win/main", "main"].find((r) =>
    sh("git", ["rev-parse", "--verify", "-q", r]),
  );
const base = sh("git", ["merge-base", "HEAD", ref]);
if (!base) {
  console.error(`check:changed: no merge-base with ${ref}`);
  process.exit(2);
}
const files = [
  ...new Set([
    ...sh("git", ["diff", "--name-only", base]).split("\n"),
    ...sh("git", ["ls-files", "--others", "--exclude-standard"]).split("\n"),
  ]),
].filter((f) => f && existsSync(f));

const all = JSON.parse(sh("npm", ["query", ".workspace"]) ?? "[]");
const root = process.cwd();
const byDepth = all
  .map((p) => ({ ...p, rel: p.path.slice(root.length + 1) }))
  .sort((a, b) => b.rel.length - a.rel.length);
const touched = new Set();
for (const f of files) {
  const ws = byDepth.find((p) => f.startsWith(`${p.rel}/`));
  if (ws) touched.add(ws.name);
}

// Transitive dependents, read from each workspace's declared dependencies.
if (args.includes("--dependents")) {
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of all) {
      if (touched.has(p.name)) continue;
      const deps = {
        ...p.dependencies,
        ...p.devDependencies,
        ...p.peerDependencies,
      };
      if (Object.keys(deps).some((d) => touched.has(d))) {
        touched.add(p.name);
        grew = true;
      }
    }
  }
}

const targets = all.filter((p) => touched.has(p.name));
const lintable = files.filter((f) => LINTED.test(f));
console.log(
  `check:changed: ${files.length} files since ${ref} (${base.slice(0, 9)})`,
);
console.log(`  workspaces: ${targets.map((p) => p.name).join(", ") || "none"}`);
if (dry) process.exit(0);

const steps = [
  [
    "biome",
    lintable.length
      ? `npx biome check --no-errors-on-unmatched ${lintable.join(" ")}`
      : "",
  ],
  ["lint:docs", "npm run -s lint:docs"],
  ["lint:bytes", "npm run -s lint:bytes"],
].filter(([, c]) => c);
let failed = steps
  .filter(([name, command]) => {
    const r = spawnSync(command, { shell: true, stdio: "inherit" });
    if (r.status !== 0) console.error(`check:changed: ${name} FAILED`);
    return r.status !== 0;
  })
  .map(([name]) => name);

const runs = targets.flatMap((p) =>
  ["typecheck", "test"]
    .filter((s) => p.scripts?.[s])
    .map((s) => ({
      command: `npm run ${s}`,
      name: `${p.name} ${s}`,
      cwd: p.path,
    })),
);
if (runs.length) {
  const { result } = concurrently(runs, {
    maxProcesses: jobs,
    group: true,
    prefix: "name",
  });
  try {
    await result;
  } catch (events) {
    failed = failed.concat(
      events.filter((e) => e.exitCode !== 0).map((e) => e.command.name),
    );
  }
}
if (failed.length) {
  console.error(`\ncheck:changed: FAILED in ${failed.join(", ")}`);
  process.exit(1);
}
console.log(
  `\ncheck:changed: passed (${steps.length} lints, ${runs.length} workspace runs)`,
);
