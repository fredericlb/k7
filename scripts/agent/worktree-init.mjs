#!/usr/bin/env node
// worktree-init.mjs — make a `.claude/worktrees/<name>` worktree of the clone ready to lint and test.
// It fills `commons/` and builds a `node_modules` whose workspace links resolve to the WORKTREE's packages.
// Run by the EnterWorktree hook of `.claude/settings.json`, or by hand with the worktree path; why: docs/agents.md.
// A plain symlink to the clone's node_modules would test the clone's `@studio/*`, not the branch's.

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";

const MARK = `${sep}.claude${sep}worktrees${sep}`;
// Per-tool caches a worktree must not share with the clone.
const OWN = new Set([".cache", ".vite", ".vite-temp"]);

function hookCwd() {
  if (process.stdin.isTTY) return undefined;
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}").cwd;
  } catch {
    return undefined;
  }
}

const start = resolve(process.argv[2] ?? hookCwd() ?? process.cwd());
const at = start.indexOf(MARK);
if (process.platform === "win32" || at === -1) process.exit(0);
const clone = start.slice(0, at);
const tree = join(
  clone,
  start
    .slice(at + 1)
    .split(sep)
    .slice(0, 3)
    .join(sep),
);
const done = [];

function fillCommons() {
  if (existsSync(join(tree, "commons", "package.json"))) return;
  const git = spawnSync(
    "git",
    [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "update",
      "--init",
      "commons",
    ],
    { cwd: tree, encoding: "utf8" },
  );
  if (git.status === 0) return done.push("commons: checked out");
  cpSync(join(clone, "commons"), join(tree, "commons"), { recursive: true });
  rmSync(join(tree, "commons", ".git"), { force: true, recursive: true });
  done.push("commons: copied from the clone (submodule update failed)");
}

// A workspace link is relative, so copying its text makes it point inside the worktree.
function mirror(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dst = join(to, name);
    if (existsSync(dst) || OWN.has(name)) continue;
    const stat = lstatSync(src);
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(src), dst);
    else if (name.startsWith("@") && hasLink(src)) mirror(src, dst);
    else symlinkSync(src, dst);
  }
}

function hasLink(dir) {
  return readdirSync(dir).some((n) => lstatSync(join(dir, n)).isSymbolicLink());
}

function fillNodeModules() {
  const own = join(tree, "node_modules");
  if (existsSync(own)) return;
  mirror(join(clone, "node_modules"), own);
  done.push("node_modules: built, workspace links point at the worktree");
}

// Nested node_modules (a workspace pinning another version) link to the clone's as they are.
function fillNested() {
  const query = spawnSync("npm", ["query", ".workspace"], {
    cwd: clone,
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  if (query.status !== 0) return;
  for (const { path } of JSON.parse(query.stdout)) {
    const rel = path.slice(clone.length + 1);
    const src = join(clone, rel, "node_modules");
    const dst = join(tree, rel, "node_modules");
    if (existsSync(src) && existsSync(join(tree, rel)) && !existsSync(dst)) {
      symlinkSync(src, dst);
      done.push(`${rel}/node_modules: linked`);
    }
  }
}

fillCommons();
fillNodeModules();
fillNested();
if (done.length)
  console.log(`worktree-init (${tree}):\n  ${done.join("\n  ")}`);
