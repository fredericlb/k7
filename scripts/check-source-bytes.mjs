// check-source-bytes.mjs — refuse a NUL byte in a tracked source file.
//
// ripgrep calls such a file BINARY and skips it without a word, so it stops existing for
// every rg-based sweep: grep, editor search, the dead-code inventory. A file can go hundreds
// of lines invisible to a reachability pass on the strength of one separator byte. Write the
// `\0` escape instead — it reads the same at runtime.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Text we search. Binary assets are expected to hold NUL and are not this check's business.
const EXTS = [
  "*.ts",
  "*.tsx",
  "*.mjs",
  "*.cjs",
  "*.js",
  "*.jsx",
  "*.cpp",
  "*.hpp",
  "*.h",
  "*.rs",
  "*.md",
  "*.yaml",
  "*.yml",
  "*.json",
  "*.css",
  "*.html",
];

// Built rather than written: a literal NUL in this source would trip the very check below.
const NUL = String.fromCharCode(0);

// `-z` so a path holding a space or a newline still arrives in one piece.
const files = execFileSync("git", ["ls-files", "-z", "--", ...EXTS], {
  encoding: "buffer",
  maxBuffer: 64 * 1024 * 1024,
})
  .toString("utf8")
  .split(NUL)
  .filter(Boolean);

const bad = [];
for (const file of files) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    continue; // a path listed but absent is the checkout's problem, not this check's
  }
  const at = buf.indexOf(0);
  if (at === -1) continue;
  // Report a LINE, because that is what the author has to go and edit.
  const line = buf.subarray(0, at).toString("utf8").split("\n").length;
  let count = 0;
  for (const b of buf) if (b === 0) count += 1;
  bad.push({ file, line, count });
}

if (bad.length) {
  console.error(
    `${bad.length} tracked source file(s) hold a NUL byte, which makes ripgrep skip them whole:\n`,
  );
  for (const b of bad)
    console.error(`  ${b.file}:${b.line} — ${b.count} NUL byte(s)`);
  console.error(
    "\nWrite the six-character escape for U+0000 instead: same string at runtime, visible to every tool.",
  );
  process.exit(1);
}

console.log(`no NUL byte in ${files.length} tracked source files`);
