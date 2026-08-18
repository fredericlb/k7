// One-shot: draw a `ui.yaml` for every module in the médiathèque that is a face for an engine
// plugin, from that plugin's own parameters. Re-runnable — it reads the plugin every time and
// writes what it finds, which is what makes it the thing to run after a Tracktion bump.
//
//   npx tsx packages/mediatek/scripts/drawPanels.ts [--only-missing] [--dry-run] [--no-backup]
//
// A pass over a folder rather than a verb, for migrateUis.ts' reason: two hundred and fifty
// panels is something you run once on a library, not a command that sits in every palette for
// ever. What it draws and why is packages/song/docs/paramPanel.md.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { EngineClient } from "@studio/engine-client/engineClient";
import type { BuiltinParam } from "@studio/song/builtinParams";
import { builtinPluginForRef } from "@studio/song/builtinParams";
import { scannedPlugins } from "@studio/song/engineCatalogue";
import { engineModuleOf } from "@studio/song/moduleTypes";
import { paramPanel } from "@studio/song/paramPanel";
import { writeUiFile } from "@studio/ui-module-builder/module-ui";
import { cacheDir, familyDir, mediatekDir } from "../src/layout.ts";
import { MODULE_FILE, UI_FILE } from "../src/scan.ts";
import { putFile } from "../src/write.ts";

const onlyMissing = process.argv.includes("--only-missing");
const dryRun = process.argv.includes("--dry-run");
const noBackup = process.argv.includes("--no-backup");
const ENGINE_URL = `ws://127.0.0.1:${process.env.STUDIO_ENGINE_PORT || 8765}`;
/** Long, because this is the wait for a plugin BINARY to load — some take seconds. */
const ASK_TIMEOUT_MS = 30_000;

/** Every folder under `modules/` holding a `module.yaml` — the scan's own rule for "a module". */
function moduleDirs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (!statSync(p).isDirectory()) continue;
    if (existsSync(join(p, MODULE_FILE))) out.push(p);
    else moduleDirs(p, out);
  }
  return out;
}

/** What a module file extends, read loosely — the same regex the builder reads it with. */
function extendsRef(text: string): string {
  const m = /^[ \t]*extends:[ \t]*(?:"([^"]*)"|'([^']*)'|([^\s#]+))/m.exec(
    text,
  );
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
}

/**
 * Which installed plugin an `@engine/…` ref names, out of this machine's scan cache.
 *
 * `engineModuleOf` is the shared rule — the ref is a slug of the display name — so the plugin
 * found here is the one a compiled document would load. The `id` is what the engine resolves:
 * two plugins can share a name, and only the binary's path names one.
 */
function scannedFor(
  ref: string,
): { name: string; format: string; id: string } | null {
  for (const p of scannedPlugins())
    if (p.id && engineModuleOf(p)?.ref === ref)
      return { name: p.name, format: p.format, id: p.id };
  return null;
}

/**
 * Ask the engine for one plugin's parameters. `null` when it did not answer.
 *
 * Matched on the id, for the reason `awaitPluginParams` in the file service is: the reply is
 * broadcast to every socket on this engine, so a frame answering somebody else's question would
 * otherwise be taken as the answer to this one — and what is built from it is a whole panel.
 */
type Answer = { found: boolean; params: BuiltinParam[] };

function askEngine(
  engine: EngineClient,
  format: string,
  id: string,
): Promise<Answer | null> {
  return new Promise((res) => {
    const done = (v: Answer | null) => {
      clearTimeout(timer);
      engine.off("pluginParamList", onList);
      res(v);
    };
    const onList = (p: {
      id: string;
      found?: boolean;
      params: BuiltinParam[];
    }) => {
      if (p.id === id) done({ found: p.found !== false, params: p.params });
    };
    const timer = setTimeout(() => done(null), ASK_TIMEOUT_MS);
    engine.on("pluginParamList", onList);
    engine.listPluginParams(format, id);
  });
}

const root = familyDir("modules");
const dirs = moduleDirs(root).sort();
const rel = (abs: string) => relative(mediatekDir(), abs).split(sep).join("/");

// Read every module first, so the run can say what it is about to do before it does any of it.
type Job = { dir: string; ref: string; hasUi: boolean };
const jobs: Job[] = [];
let notAFace = 0;
for (const dir of dirs) {
  const ref = extendsRef(readFileSync(join(dir, MODULE_FILE), "utf8"));
  if (!ref.startsWith("@engine/")) {
    notAFace++;
    continue;
  }
  const hasUi = existsSync(join(dir, UI_FILE));
  if (onlyMissing && hasUi) continue;
  jobs.push({ dir, ref, hasUi });
}

const overwriting = jobs.filter((j) => j.hasUi);
console.log(
  `${dirs.length} module(s): ${jobs.length} to draw, ${notAFace} face no engine plugin` +
    (onlyMissing
      ? ", already drawn skipped"
      : `, ${overwriting.length} overwritten`),
);

/**
 * Copy the panels about to be replaced, into the médiathèque's own hidden `.cache`.
 *
 * Written with `copyFileSync` and NOT `putFile`, deliberately: `writablePath` refuses a path
 * segment beginning with a dot, which is exactly what keeps `.cache` invisible to the file API
 * and to every family scan. A backup that the médiathèque listed as content would be two
 * hundred and fifty modules' worth of noise in the tree.
 */
function backup(stamp: string): string {
  const into = join(cacheDir(), `ui-backup-${stamp}`);
  for (const j of overwriting) {
    const dst = join(into, rel(join(j.dir, UI_FILE)));
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(join(j.dir, UI_FILE), dst);
  }
  return into;
}

const engine = new EngineClient(ENGINE_URL);
engine.on("wserror", () => {});
// Re-dial if the link goes. `EngineClient` does not on its own — the file service wires that
// itself — and without it ONE dropped socket turns the rest of the run into a wall of timeouts
// rather than a gap: every later ask goes into a closed socket's outbox and is never sent. That
// is exactly what a batch looked like before the engine stopped dying under one.
let done = false;
engine.on("close", () => {
  if (!done) setTimeout(() => engine.connect(), 1000);
});
engine.connect();

let drawn = 0;
const empty: string[] = [];
const unanswered: string[] = [];
try {
  if (overwriting.length && !dryRun && !noBackup)
    console.log(
      `backup: ${backup(new Date().toISOString().replace(/[:.]/g, "-"))}`,
    );

  for (const j of jobs) {
    // A built-in is answered from the generated table: no engine, nothing to wait for, and the
    // same answer on every machine. Only what is NOT in it costs a plugin load.
    //
    // The test is whether the table KNOWS the plugin, not whether it lists parameters for it.
    // Patch Bay, Text, Insert, Aux Return and three others are in it with none — their state is
    // not parameters — and reading that as "not a built-in" sent seven of them to the engine,
    // which does not have them: they are not external plugins, so `describeExternal` finds
    // nothing and the empty answer came back looking like a plugin that failed to load.
    const builtin = builtinPluginForRef(j.ref);
    let params: BuiltinParam[] = builtin?.params ?? [];
    let from = "table";
    if (!builtin) {
      const scan = scannedFor(j.ref);
      if (!scan) {
        unanswered.push(`${j.ref} — not in this machine's scan`);
        continue;
      }
      const answer = await askEngine(engine, scan.format, scan.id);
      from = "engine";
      if (answer === null) {
        unanswered.push(`${j.ref} — the engine did not answer`);
        continue;
      }
      if (!answer.found) {
        unanswered.push(
          `${j.ref} — this machine cannot LOAD it (see the engine log)`,
        );
        continue;
      }
      params = answer.params;
    }
    // An empty list is a real answer, from either side, and the panel is simply not written:
    // Patch Bay, Text and Insert have no parameters because their state is not parameters, and
    // a whole vendor's synths declare none to a host at all. A grid with nothing in it says
    // less than its absence does. What is NOT this case — a plugin that could not be loaded —
    // was separated out above, so nothing counted here is a fault.
    if (!params.length) {
      empty.push(j.ref);
      continue;
    }
    const path = `${rel(j.dir)}/${UI_FILE}`;
    if (!dryRun) putFile(path, writeUiFile("", paramPanel(params)));
    drawn++;
    console.log(
      `  ${params.length.toString().padStart(4)} ${from.padEnd(6)} ${path}`,
    );
  }
} finally {
  done = true;
  engine.close();
}

console.log(
  `${drawn} panel(s) ${dryRun ? "would be drawn" : "drawn"}, ${empty.length} plugin(s) declare no parameters`,
);
// Named, never counted: "twelve could not be asked" is a number nobody can act on. The two
// lists are kept apart because only the second is a fault — see the empty-list comment above.
if (empty.length) console.log(`  no parameters: ${empty.join(", ")}`);
for (const u of unanswered) console.error(`  ! ${u}`);
