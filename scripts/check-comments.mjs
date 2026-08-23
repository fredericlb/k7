// check-comments.mjs — the three comment rules from AGENTS.md, counted rather than argued about:
// a header of at most 10 lines, one line per comment inside the body, and English throughout.
//
// Non-blocking, like lint:dead. It reports a debt that predates the rule, so the number is a
// budget to spend down as files are touched — not a gate. New code has no excuse.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const HEADER_MAX = 10;

/** Lines that are a directive rather than prose, so length rules do not apply. */
const DIRECTIVE =
  /^\s*(\/\/|\/\*)\s*(biome-ignore|eslint|@ts-|prettier-ignore|<reference)/;

const isComment = (l) => /^\s*(\/\/|\/\*|\*)/.test(l);
const isBlank = (l) => /^\s*$/.test(l);

/**
 * French prose, detected on FUNCTION WORDS rather than on accents.
 *
 * Accents were the first try and they cannot work: this codebase writes the names of its own
 * things — the médiathèque, a dépôt, a chaîne — inside perfectly good English sentences, so an
 * accent test flags prose that is already fine and never reaches zero. Function words are what a
 * language actually is, and they also catch French that happens to carry no accent.
 */
/**
 * Quoted spans, dropped before the test.
 *
 * The screens are in French, so an English comment naming one quotes it — « Trouver des morceaux »
 * is the button's name, not prose to translate. Only the guillemet and double-quote forms, because
 * the apostrophe is a French letter and stripping `'…'` would eat the sentence around it.
 */
const QUOTED = /«[^»]*»|"[^"]*"/g;

// `on`, `son`, `plus`, `sa` and `vers` are English words too and are deliberately absent.
const FRENCH =
  /(^|[\s("'`])(le|les|une|des|du|aux|cet|cette|ces|qui|que|dont|sont|pas|pour|dans|avec|sans|donc|mais|alors|c'est|n'est|qu'il|qu'elle|elle|nous|vous|leur|ses|ainsi|ici|celui|celle|ceux|rien|tout|toute|toutes|tous|entre|chez|depuis|jamais|toujours|lorsque|parce|puisque|d'un|d'une|l'on|n'a|qu'on)([\s,.;:!?)"'`]|$)/i;

const files = execFileSync(
  "git",
  ["ls-files", "*.ts", "*.tsx", "*.mjs", "*.mts"],
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
  while (i < lines.length && isBlank(lines[i])) i++;
  const headerStart = i;
  while (i < lines.length && isComment(lines[i])) i++;
  const headerLen = i - headerStart;
  if (headerLen > HEADER_MAX)
    longHeaders.push({ file, line: headerStart + 1, len: headerLen });

  // Every comment run in the body. Two consecutive comment lines is already a block.
  for (let j = i; j < lines.length; j++) {
    if (!isComment(lines[j]) || DIRECTIVE.test(lines[j])) continue;
    let k = j;
    while (k < lines.length && isComment(lines[k])) k++;
    if (k - j > 1) blocks.push({ file, line: j + 1, len: k - j });
    j = k;
  }

  for (const [n, l] of lines.entries())
    if (isComment(l) && FRENCH.test(l.replace(QUOTED, " ")))
      french.push({ file, line: n + 1 });
}

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
