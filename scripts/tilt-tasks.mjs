#!/usr/bin/env node
// tilt-tasks.mjs — the dev-session task list as JSON, for the Tiltfile: the same
// derivation as scripts/dev.mjs (a package joins by having a `dev` script; the
// tray, the aggregators and the tsc watchers are dropped, for dev.mjs's reasons).
// Part of the Tilt trial — see docs/dev.md.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

function workspacePackages() {
  const root = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const dirs = new Set();
  for (const glob of root.workspaces) {
    if (!glob.includes("*")) {
      dirs.add(join(repo, glob));
      continue;
    }
    const base = join(repo, glob.slice(0, glob.indexOf("*")));
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true }))
      if (entry.isDirectory()) dirs.add(join(base, entry.name));
  }
  return [...dirs].flatMap((dir) => {
    const file = join(dir, "package.json");
    if (!existsSync(file)) return [];
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    return pkg.name && pkg.scripts?.dev
      ? [{ name: pkg.name, dev: pkg.scripts.dev, dir }]
      : [];
  });
}

const isAggregator = (dev) => dev.trimStart().startsWith("turbo run");
const isTypecheck = (dev) => /\btsc\b/.test(dev) && dev.includes("--watch");

const tasks = workspacePackages()
  .filter(
    ({ name, dev }) =>
      name !== "capot" && !isAggregator(dev) && !isTypecheck(dev),
  )
  .map(({ name, dir }) => {
    const rel = relative(repo, dir).replaceAll("\\", "/");
    return {
      name,
      // Tilt resource names allow only [A-Za-z0-9_-]; `moteur` is the native monitor.
      label:
        name === "moteur"
          ? "native"
          : name.replace(/^@/, "").replace(/[^A-Za-z0-9_-]+/g, "-"),
      dir: rel,
      group: rel.split("/")[0],
    };
  });

process.stdout.write(JSON.stringify(tasks));
