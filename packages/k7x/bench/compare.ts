// compare.ts — the Rust parser (rust/) against src/parse.ts: the same tree on every file, then the time each takes.
// A reader would get wrong what "cold" is: each side's first pass in a fresh process, JIT warm-up and all (docs/rust.md).

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { build } from "esbuild";
import { toJS } from "../src/ast.ts";
import { fromYaml } from "../src/fromYaml.ts";
import { nativeData, nativeReady } from "../src/native.ts";
import { K7SyntaxError, parseTree } from "../src/parse.ts";
import { stringify } from "../src/print.ts";

const HERE = import.meta.dirname;
const ROOT = join(HERE, "..", "..", "..");
const RUST = join(HERE, "..", "rust");
const ITERS = Number(process.env.K7X_BENCH_ITERS ?? 50);
const out = mkdtempSync(join(tmpdir(), "k7x-bench-"));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) return walk(abs);
    return /\.(ya?ml|k7x)$/.test(name) ? [abs] : [];
  });
}

// Every corpus file as k7x text: YAML converted, a .k7x file read as is.
const corpus: [string, string][] = [];
for (const file of ["demos", "k7-core"].flatMap((d) => walk(join(ROOT, d)))) {
  const raw = readFileSync(file, "utf8");
  try {
    corpus.push([
      relative(ROOT, file),
      file.endsWith(".k7x") ? raw : fromYaml(raw),
    ]);
  } catch {
    // A YAML file fromYaml refuses is no k7x file, so it is not in the corpus.
  }
}

const big = stringify(
  Object.fromEntries(
    corpus.map(([name, text], i) => [
      `f${i}`,
      { name, data: toJS(parseTree(text)) },
    ]),
  ),
);

const broken = [
  "a(1",
  'a("x',
  "a(foo)",
  "a(1) a(2)",
  "a({ b: 1, b: 2 })",
  "a(-)",
  "a([1, 2)",
  "a(`x",
  "/* x",
  'a("\\q")',
  'a("\\u12")',
  "é(1)",
  'a("é")\nb(\n  bare)',
  `a(${"[".repeat(300)}${"]".repeat(300)})`,
  "a(1)\n.b(2)\n.",
];

function writeSet(name: string, texts: string[]): string {
  const files = texts.map((t, i) => {
    const f = join(out, `${name}-${i}.k7x`);
    writeFileSync(f, t);
    return f;
  });
  const list = join(out, `${name}.list`);
  writeFileSync(list, files.join("\n"));
  return list;
}

const sets = {
  corpus: writeSet(
    "corpus",
    corpus.map(([, t]) => t),
  ),
  largest: writeSet("largest", [
    corpus.reduce((a, b) => (b[1].length > a[1].length ? b : a))[1],
  ]),
  big: writeSet("big", [big]),
  broken: writeSet("broken", broken),
};

execFileSync("cargo", ["build", "--release", "--quiet"], {
  cwd: RUST,
  stdio: "inherit",
});
const bin = join(
  RUST,
  "target",
  "release",
  process.platform === "win32" ? "k7x-bench.exe" : "k7x-bench",
);

// The parity check: the Rust tree, spans in UTF-16 units, must equal parseTree's own, error or not.
function tsResult(text: string): unknown {
  try {
    return JSON.parse(JSON.stringify(parseTree(text)));
  } catch (e) {
    if (!(e instanceof K7SyntaxError)) throw e;
    const message = e.message.replace(/ \(\d+:\d+\)$/, "");
    return {
      error: { message, offset: e.offset, line: e.line, column: e.column },
    };
  }
}

let mismatches = 0;
for (const [name, list] of Object.entries(sets)) {
  const dump = join(out, `${name}.jsonl`);
  execFileSync(bin, ["dump", list, dump]);
  const lines = readFileSync(dump, "utf8").split("\n").filter(Boolean);
  const files = readFileSync(list, "utf8").split("\n");
  files.forEach((f, i) => {
    const want = tsResult(readFileSync(f, "utf8"));
    const got = JSON.parse(lines[i]);
    if (isDeepStrictEqual(got, want)) return;
    mismatches++;
    if (mismatches <= 5)
      console.error(
        `MISMATCH ${f}\n  ts:   ${JSON.stringify(want).slice(0, 300)}\n  rust: ${lines[i].slice(0, 300)}`,
      );
  });
  console.log(
    `parity ${name}: ${files.length} files, ${mismatches} mismatches so far`,
  );
}
if (mismatches > 0) process.exit(1);

const bundle = join(out, "parse.mjs");
await build({
  entryPoints: [join(HERE, "..", "src", "parse.ts")],
  bundle: true,
  format: "esm",
  outfile: bundle,
  logLevel: "error",
});

interface Run {
  cold: number;
  min: number;
  median: number;
  files: number;
  bytes: number;
}
const run = (cmd: string, args: string[]): Run =>
  JSON.parse(execFileSync(cmd, args, { encoding: "utf8" }));
const runJs = join(HERE, "runJs.mjs");

for (const name of ["corpus", "largest", "big"] as const) {
  const list = sets[name];
  const rows: [string, Run][] = [
    ["node (JIT)", run(process.execPath, [runJs, bundle, list, String(ITERS)])],
    [
      "node --jitless",
      run(process.execPath, ["--jitless", runJs, bundle, list, String(ITERS)]),
    ],
    ["rust, arena per file", run(bin, ["bench", list, String(ITERS), "fresh"])],
    [
      "rust, one arena reset",
      run(bin, ["bench", list, String(ITERS), "reuse"]),
    ],
  ];
  // Another build of the Rust half to time beside this one, e.g. a previous commit's: K7X_BASELINE_BIN=label=path.
  const baseline = process.env.K7X_BASELINE_BIN?.split("=");
  if (baseline)
    rows.push([
      baseline[0],
      run(baseline.slice(1).join("="), ["bench", list, String(ITERS)]),
    ]);
  const { files, bytes } = rows[0][1];
  const rust = rows[2][1];
  console.log(
    `\n${name}: ${files} file(s), ${(bytes / 1e6).toFixed(2)} MB, ${ITERS} passes`,
  );
  console.log(
    "| parser | cold pass ms | median pass ms | MB/s (median) | median vs rust |",
  );
  console.log("|---|---|---|---|---|");
  for (const [label, r] of rows)
    console.log(
      `| ${label} | ${r.cold.toFixed(2)} | ${r.median.toFixed(2)} | ${(bytes / 1e3 / r.median).toFixed(0)} | ${(r.median / rust.median).toFixed(1)}x |`,
    );
}

// What a reader gets: a file's plain data, from parse.ts + toJS, or from the WebAssembly reader + JSON.parse.
const texts = corpus.map(([, t]) => t);
const timeData = (read: (t: string) => unknown): number => {
  const runs = Array.from({ length: 20 }, () => {
    const t = performance.now();
    for (const text of texts) read(text);
    return performance.now() - t;
  });
  return runs.sort((a, b) => a - b)[10];
};
await nativeReady();
const viaJs = timeData((t) => toJS(parseTree(t)));
const viaWasm = timeData((t) => nativeData(t));
console.log(
  `\ndata of the corpus, in this node: parse.ts + toJS ${viaJs.toFixed(1)} ms, WebAssembly + JSON.parse ${viaWasm.toFixed(1)} ms (${(viaJs / viaWasm).toFixed(1)}x)`,
);
