#!/usr/bin/env node
// tokens.mjs — `npm run tokens`: give st0's backend its own API_TOKEN_SECRET in env.yaml, so the
// tokens it signs do not hang off SESSION_SECRET. No service-to-service token is minted any more:
// every caller that needed one is now mounted in the same process. See docs/tokens.md.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
/** `--env <file>`, so a test runs the real script against a scratch copy of the secrets. */
const at = args.indexOf("--env");
const ENV_FILE =
  at >= 0 && args[at + 1] ? args[at + 1] : join(repo, "env.yaml");

// The service that VERIFIES the tokens holds the secret: st0's backend, which serves the library.
const PATH = ["st0-backend", "API_TOKEN_SECRET"];

if (!existsSync(ENV_FILE)) {
  console.error(`no ${ENV_FILE} — copy env.example.yaml first`);
  process.exit(1);
}
// Edited as a yaml DOCUMENT, so the comments of a hand-edited file survive.
const doc = parseDocument(readFileSync(ENV_FILE, "utf8"), { version: "1.2" });

const current = doc.getIn(PATH);
if (typeof current === "string" && current.trim()) {
  console.log(`  ${PATH.join(".")}: already set`);
  process.exit(0);
}

if (!doc.has(PATH[0])) doc.set(PATH[0], {});
doc.setIn(PATH, randomBytes(32).toString("hex"));
if (dryRun) {
  console.log(
    `  ${PATH.join(".")}: would be generated\n\n  --dry-run: nothing was written`,
  );
  process.exit(0);
}
writeFileSync(ENV_FILE, doc.toString({ lineWidth: 0 }), "utf8");
console.log(
  `  ${PATH.join(".")}: generated\n\n  ${ENV_FILE} updated — restart st0's backend; every token signed with the old secret is now void`,
);
