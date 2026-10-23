#!/usr/bin/env node
// biome-on-edit.mjs — the PostToolUse hook that runs biome on the js/ts/json file an agent just wrote.
// AGENTS.md wants every edited file to pass biome; this says so while the file is still on screen.
// Exit 2 hands biome's report to the agent (the edit already happened); why: docs/agents.md.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative } from "node:path";

const LINTED = /\.(?:[cm]?[jt]sx?|jsonc?)$/;

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}
const file = input.tool_input?.file_path;
if (!file || !LINTED.test(file) || !existsSync(file)) process.exit(0);

const top = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: dirname(file),
  encoding: "utf8",
});
if (top.status !== 0) process.exit(0);
const root = top.stdout.trim();
if (!existsSync(`${root}/node_modules/.bin/biome`)) process.exit(0);

const run = spawnSync(
  `${root}/node_modules/.bin/biome`,
  ["check", "--no-errors-on-unmatched", "--colors=off", relative(root, file)],
  { cwd: root, encoding: "utf8" },
);
if (run.status === 0) process.exit(0);
process.stderr.write(
  `biome check failed on ${relative(root, file)} (npx biome check --write fixes formatting):\n${run.stdout}${run.stderr}`.slice(
    0,
    6000,
  ),
);
process.exit(2);
