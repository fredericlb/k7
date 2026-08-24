// check-comments.mjs — the three comment rules from AGENTS.md, counted rather than argued about:
// a header of at most 10 lines, one line per comment inside the body, and English throughout.
//
// Non-blocking, like lint:dead. It reports a debt that predates the rule, so the number is a
// budget to spend down as files are touched — not a gate. New code has no excuse.
// Why it scans blocks rather than matching line by line: ../docs/lints.md.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const HEADER_MAX = 10;

/** A run of `/* … *\/` with no closing marker is a template literal, not a comment — bail out. */
const RUNAWAY = 60;

/** Lines that are a directive rather than prose, so length rules do not apply. */
const DIRECTIVE =
  /^\s*(\{\s*)?(\/\/|\/\*)\s*(biome-ignore|eslint|@ts-|prettier-ignore|<reference|NOLINT|clang-format)/;

/** Opens a block comment: `/*`, `/**`, or JSX's `{/*` — the last is why this is not a line match. */
const OPENS = /^\s*(\{\s*)?\/\*/;
const CLOSES = /\*\//;
const LINE = /^\s*\/\//;
const isBlank = (l) => /^\s*$/.test(l);

/** Lines a file may open with before its header: a shebang, `#pragma once`, an `#ifndef` guard. */
const PREAMBLE = /^(#!|\s*#\s*(pragma once|ifndef|define)\b)/;

/** Quoted spans, dropped before a test that reads FUNCTION WORDS and not accents (../docs/lints.md). */
const QUOTED = /«[^»]*»|"[^"]*"/g;

// `on`, `son`, `plus`, `sa` and `vers` are English words too and are deliberately absent.
const FRENCH =
  /(^|[\s("'`])(le|les|une|des|du|aux|cet|cette|ces|qui|que|dont|sont|pas|pour|dans|avec|sans|donc|mais|alors|c'est|n'est|qu'il|qu'elle|elle|nous|vous|leur|ses|ainsi|ici|celui|celle|ceux|rien|tout|toute|toutes|tous|entre|chez|depuis|jamais|toujours|lorsque|parce|puisque|d'un|d'une|l'on|n'a|qu'on)([\s,.;:!?)"'`]|$)/i;

/** Every comment RUN from `from` on, plus the lines each covers — see ../docs/lints.md. */
function runs(lines, from) {
  const out = [];
  const covered = new Set();
  let i = from;
  while (i < lines.length) {
    if (OPENS.test(lines[i])) {
      let k = i;
      while (k < lines.length && !CLOSES.test(lines[k]) && k - i < RUNAWAY) k++;
      if (k - i >= RUNAWAY) {
        i++;
        continue;
      }
      for (let n = i; n <= k; n++) covered.add(n);
      if (k > i && !DIRECTIVE.test(lines[i]))
        out.push({ line: i + 1, len: k - i + 1 });
      i = k + 1;
      continue;
    }
    if (LINE.test(lines[i])) {
      let k = i;
      while (k < lines.length && LINE.test(lines[k])) k++;
      for (let n = i; n < k; n++) covered.add(n);
      // A directive inside a run SPLITS it: it is not prose, and it may not share a line with any.
      let seg = i;
      for (let n = i; n <= k; n++) {
        if (n === k || DIRECTIVE.test(lines[n])) {
          if (n - seg > 1) out.push({ line: seg + 1, len: n - seg });
          seg = n + 1;
        }
      }
      i = k;
      continue;
    }
    i++;
  }
  return { out, covered };
}

const files = execFileSync(
  "git",
  // C++ too: AGENTS.md says the three limits hold in every language here, and the engine is one.
  ["ls-files", "*.ts", "*.tsx", "*.mjs", "*.mts", "*.cpp", "*.h", "*.hpp"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)
  .split("\n")
  .filter(Boolean)
  // The submodule carries its own rules and its own history.
  .filter((f) => !f.startsWith("commons/"))
  // Generated, and nobody reads it.
  .filter((f) => !/\.generated\.|paraglide\//.test(f));

const longHeaders = [];
const blocks = [];
const french = [];

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = text.split("\n");

  // The header is the comment run the file opens with, after any blank lines.
  let i = 0;
  // What may sit ABOVE the header: a shebang, or a C++ include guard (../docs/lints.md).
  while (i < lines.length && (isBlank(lines[i]) || PREAMBLE.test(lines[i]))) i++;
  const headerStart = i;
  while (i < lines.length && /^\s*(\/\/|\/\*|\*)/.test(lines[i])) i++;
  const headerLen = i - headerStart;
  if (headerLen > HEADER_MAX)
    longHeaders.push({ file, line: headerStart + 1, len: headerLen });

  const { out, covered } = runs(lines, i);
  for (const b of out) blocks.push({ file, ...b });

  for (const n of covered)
    if (FRENCH.test(lines[n].replace(QUOTED, " ")))
      french.push({ file, line: n + 1 });
}

french.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

const show = (list, label, fmt) => {
  if (!list.length) return;
  console.log(`\n${label} (${list.length})`);
  for (const d of list.slice(0, 15)) console.log(`  ${fmt(d)}`);
  if (list.length > 15) console.log(`  … and ${list.length - 15} more`);
};

show(
  longHeaders,
  `Headers over ${HEADER_MAX} lines`,
  (d) => `${d.file}:${d.line} — ${d.len} lines`,
);
show(
  blocks,
  "Multi-line comments in the body",
  (d) => `${d.file}:${d.line} — ${d.len} lines`,
);
show(french, "Comments that are not in English", (d) => `${d.file}:${d.line}`);

const total = longHeaders.length + blocks.length + french.length;
console.log(
  `\n${total} finding(s) across ${files.length} files` +
    ` — ${longHeaders.length} long header(s), ${blocks.length} comment block(s), ${french.length} non-English line(s).`,
);
if (total) process.exit(1);
