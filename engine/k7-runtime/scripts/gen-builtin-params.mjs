// gen-builtin-params.mjs — ask the engine what every built-in plugin's parameters are, and write the
// table @studio/song-schema ships. Run it after bumping Tracktion or adding a built-in; the file it
// writes is generated and committed, so no build step depends on a C++ binary.
// The table is JSON with one plugin per line, so a real change reads as the plugins it touched.
// See docs/builtinParams.md.

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const moteur = join(here, "..");
const OUT = join(
  moteur,
  "..",
  "..",
  "packages",
  "song-schema",
  "src",
  "builtinParams.generated.json",
);

/** Wherever the current platform's preset put the binary. First one that exists wins. */
function engineBinary() {
  const candidates = [
    "build/windows-msvc/RelWithDebInfo/k7-runtime.exe",
    "build/macos-clang/k7-runtime",
    "build/dev-gcc/k7-runtime",
    "build/dev-clang/k7-runtime",
    "build/release-gcc/k7-runtime",
  ].map((p) => join(moteur, p));
  const found = candidates.find((p) => existsSync(p));
  if (!found)
    throw new Error(
      `no k7-runtime binary — build it first (npm run build:win|build:mac --workspace k7-runtime).\nLooked in:\n  ${candidates.join("\n  ")}`,
    );
  return found;
}

const BEGIN = "STUDIO_PARAMS_BEGIN";
const END = "STUDIO_PARAMS_END";

const raw = execFileSync(engineBinary(), ["--dump-builtin-params"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const from = raw.indexOf(BEGIN);
const to = raw.indexOf(END);
if (from < 0 || to < 0)
  throw new Error(`no sentinels in the engine's output:\n${raw.slice(0, 400)}`);
const table = JSON.parse(raw.slice(from + BEGIN.length, to).trim());

/** Ranges come out of C++ as doubles; keep them short and exact. */
const num = (v) => (Number.isInteger(v) ? v : Number(v.toPrecision(10)));

const lines = [];
let plugins = 0;
let params = 0;
for (const [type, info] of Object.entries(table)) {
  plugins++;
  // An empty list is kept rather than dropped: "has none" and "never asked" are different answers.
  const out = { name: info.name, role: info.role, params: [] };
  for (const p of info.params) {
    params++;
    const param = { name: p.name, min: num(p.min), max: num(p.max) };
    if (p.def !== null && p.def !== undefined) param.def = num(p.def);
    if (p.automatable === false) param.automatable = false;
    if (p.states?.length)
      param.states = p.states.map((s) => ({ label: s.label, value: num(s.value) }));
    out.params.push(param);
  }
  lines.push(`${JSON.stringify(type)}: ${JSON.stringify(out)}`);
}

writeFileSync(OUT, `{\n${lines.join(",\n")}\n}\n`, "utf8");
console.log(`${OUT}: ${plugins} plugins, ${params} parameters`);
