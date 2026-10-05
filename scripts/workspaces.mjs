#!/usr/bin/env node
// workspaces.mjs — run one npm script in every workspace that declares it, `--jobs N` at a time.
// `node scripts/workspaces.mjs test --jobs 4`; the default is 1, which is `npm run test --workspaces --if-present`.
// Output is grouped per workspace, and the run fails when any one of them does. Why bounded: docs/tests.md.

import { spawnSync } from "node:child_process";
import concurrently from "concurrently";

const args = process.argv.slice(2);
const at = args.indexOf("--jobs");
const jobs = at === -1 ? 1 : Number(args[at + 1]);
const script = args.find(
  (a, i) => !a.startsWith("--") && (at === -1 || i !== at + 1),
);
if (!script || !(jobs >= 1)) {
  console.error("usage: workspaces.mjs <script> [--jobs N]");
  process.exit(2);
}

const query = spawnSync("npm", ["query", ".workspace"], {
  encoding: "utf8",
  shell: true,
  maxBuffer: 64 << 20,
});
if (query.status !== 0) {
  console.error(query.stderr || "npm query .workspace failed");
  process.exit(1);
}
const workspaces = JSON.parse(query.stdout).filter((p) => p.scripts?.[script]);

const started = Date.now();
const { result } = concurrently(
  workspaces.map((p) => ({
    command: `npm run ${script}`,
    name: p.name,
    cwd: p.path,
  })),
  { maxProcesses: jobs, group: true, prefix: "name" },
);
try {
  await result;
  console.log(
    `\n${script}: ${workspaces.length} workspaces passed in ${Math.round((Date.now() - started) / 1000)}s (--jobs ${jobs})`,
  );
} catch (events) {
  const failed = events
    .filter((e) => e.exitCode !== 0)
    .map((e) => e.command.name);
  console.error(`\n${script}: FAILED in ${failed.join(", ")}`);
  process.exit(1);
}
