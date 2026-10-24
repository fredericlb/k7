// library.spec.ts — every leaf module of the @k7-core library compiles in a project of its own, then loads on the engine.
// What is left out is decided per module from what it extends, never by its name; the engine half reads the engine's log.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Page } from "@playwright/test";
import { builtinPluginForRef } from "@studio/song-schema/builtinParams";
import { FileService } from "../../src/files.ts";
import { expect, TARGET, test } from "../../src/target.ts";

const WORKSPACE = "E2E-library";
const LIBRARY = join(import.meta.dirname, "../../../k7-core/modules");
// Built-ins that load nothing until a node names a file of the user's: a .nam model, an impulse response.
const NEEDS_A_USER_FILE = new Set(["neural-amp-modeler", "impulse-response"]);
// A module that fails today, by label, with the bug: its check must keep failing until the bug is fixed.
const KNOWN_BROKEN: Record<string, string> = {};

type Kind = "instrument" | "effect" | "midi";

interface Case {
  family: string;
  ref: string;
  engine?: string;
  // The folder whose module.k7x the node actually runs: the engine's when there is one.
  dir: string;
  kind: Kind;
}

const hasModule = (dir: string) => existsSync(join(dir, "module.k7x"));
const subdirs = (dir: string) =>
  readdirSync(dir)
    .map((n) => join(dir, n))
    .filter((p) => statSync(p).isDirectory());
// Comments dropped, so a ref quoted in prose is never read as the module's own.
const moduleText = (dir: string) =>
  readFileSync(join(dir, "module.k7x"), "utf8")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");

function kindOf(rel: string): Kind {
  if (rel.startsWith("instruments/")) return "instrument";
  if (rel.startsWith("transformers/")) return "midi";
  return "effect";
}

/** Every module a node can name: a leaf, or each engine of a module that has engines/. */
function libraryCases(dir = LIBRARY): Case[] {
  if (!hasModule(dir)) return subdirs(dir).flatMap((d) => libraryCases(d));
  const rel = relative(LIBRARY, dir).split("\\").join("/");
  const base = {
    family: rel.split("/")[0],
    ref: `@k7-core/${rel}`,
    kind: kindOf(rel),
  };
  const engines = join(dir, "engines");
  if (!existsSync(engines)) return [{ ...base, dir }];
  return subdirs(engines)
    .filter(hasModule)
    .map((d) => ({ ...base, engine: d.split(/[\\/]/).pop(), dir: d }));
}

/** The module's text after following its @k7-core extends, which is where its plugin is named. */
function resolvedText(dir: string): string {
  let text = moduleText(dir);
  for (let hops = 0; hops < 8; hops++) {
    const up = text.match(/extends\("@k7-core\/([^"]+)"\)/);
    if (!up) break;
    text = `${moduleText(join(LIBRARY, up[1]))}\n${text.replace(up[0], "")}`;
  }
  return text;
}

const engineSlug = (text: string) =>
  text.match(/extends\("@engine\/([^"]+)"\)/)?.[1];
const isOffline = (text: string) => /plugin\(\{\s*type:\s*"offline"/.test(text);

/** Why this module cannot even compile on an arbitrary server, or undefined when it can. */
function cannotCompile(c: Case): string | undefined {
  const text = resolvedText(c.dir);
  if (/type\("shader"\)/.test(text))
    return "a shader is picture: a video project's /video-doc compiles it, not the engine document";
  const slug = engineSlug(text);
  if (slug && !builtinPluginForRef(`@engine/${slug}`))
    return `@engine/${slug} is an external plugin, known only to a machine whose scan found it`;
  return undefined;
}

/** Why this module compiles but cannot load on this engine, or undefined when it can. */
function cannotLoad(c: Case): string | undefined {
  const text = resolvedText(c.dir);
  if (/sfz:\s*"@instruments\//.test(text))
    return "SFZ: its samples are @instruments/ files the engine's machine downloads on request";
  const slug = engineSlug(text);
  if (slug && NEEDS_A_USER_FILE.has(slug))
    return `@engine/${slug} loads nothing until the node names a file of the user's`;
  if (isOffline(text))
    return "an offline module is a pass that writes files before the render, never a plugin (packages/song/docs/coldModules.md)";
  return cannotCompile(c);
}

/** The plugin type the engine document carries for this module, when its text says it plainly. */
function expectedType(c: Case): string | undefined {
  const text = resolvedText(c.dir);
  const slug = engineSlug(text);
  if (slug) return builtinPluginForRef(`@engine/${slug}`)?.name;
  return text.match(
    /plugin\(\{\s*type:\s*"internal",\s*name:\s*"([^"]+)"/,
  )?.[1];
}

const label = (c: Case) => (c.engine ? `${c.ref} engine ${c.engine}` : c.ref);

const projectFile = (name: string) =>
  `project({ name: "${name}", tempo: 120, sampleRate: 48000, timeSignature: "4/4", video: false })\nmarkers({})\n`;
const NOTES =
  "notes([t(0).d(4).k(48).v(0.8), t(0).d(4).k(55), t(0).d(4).k(60)])\n";
const SOURCE = `extends("@k7-core/instruments/k7-4osc")\n`;
// A rack plays only the taps its node declares, so a rack engine gets one.
const RACK_TAPS = `rack({ symbols: { Kick:{ note: 36, sample: "@k7-core/naked_drums/Kick.wav" } } })\n`;

const trackNode = (seq: string) =>
  `extends("@meta/track")\nevents([ref("${seq}").start("1:1:1")])\n`;

function moduleNode(c: Case): string {
  const engine = c.engine ? `engine("${c.engine}")\n` : "";
  const rack = /type\("rack"\)/.test(resolvedText(c.dir)) ? RACK_TAPS : "";
  return `extends("${c.ref}")\n${engine}${rack}`;
}

// Nodes m0, m1…: an instrument on a lane of its own, the rest in one run around 4OSC; a cold module too (packages/song/docs/fileInput.md).
function projectFiles(cases: Case[], name = "library"): Record<string, string> {
  const files: Record<string, string> = {
    "project.k7x": projectFile(name),
    "surfaces/timeline.k7x": `type("timeline")\nlayout("split")\n`,
  };
  const graph: Record<string, string[]> = { MIX: ["OUT"] };
  const run = (head: string, nodes: string[]) => {
    [head, ...nodes].forEach((n, i, all) => {
      graph[n] = [all[i + 1] ?? "MIX"];
    });
  };
  const ids = cases.map((_, i) => `m${i}`);
  cases.forEach((c, i) => {
    files[`nodes/${ids[i]}.k7x`] = moduleNode(c);
  });
  const instruments = ids.filter((_, i) => cases[i].kind === "instrument");
  for (const m of instruments) {
    files[`nodes/s${m}.k7x`] = trackNode(`s${m}`);
    files[`sequences/s${m}.k7x`] = NOTES;
    run(`s${m}`, [m]);
  }
  const midi = ids.filter((_, i) => cases[i].kind === "midi");
  const effects = ids.filter((_, i) => cases[i].kind === "effect");
  if (midi.length || effects.length) {
    files["nodes/seq.k7x"] = trackNode("seq");
    files["sequences/seq.k7x"] = NOTES;
    files["nodes/src.k7x"] = SOURCE;
    run("seq", [...midi, "src", ...effects]);
  }
  const edges = Object.entries(graph)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ");
  files["graph.k7x"] = `modules({ ${edges} })\n`;
  return files;
}

async function writeProject(
  files: FileService,
  project: string,
  content: Record<string, string>,
) {
  await Promise.all(
    Object.entries(content).map(([path, text]) =>
      files.writeText(WORKSPACE, `${project}/${path}`, text),
    ),
  );
}

// The slice of @studio/engine-protocol's ProjectDoc read here.
type EngineDoc = { tracks: { plugins: { name: string; type: string }[] }[] };

// A compiler message names its node `'m3'`, a diagnostic its file `nodes/m3.k7x`.
const namesNode = (text: string, i: number) =>
  text.includes(`'m${i}'`) || text.includes(`/m${i}.k7x`);

/** What is wrong with each of `cases`, compiled together as nodes m0, m1…, and what names none of them. */
async function compileProblems(
  files: FileService,
  project: string,
  cases: Case[],
): Promise<{ each: string[][]; rest: string[] }> {
  await writeProject(files, project, projectFiles(cases));
  await files.open(WORKSPACE, project);
  const { errors, diagnostics } = (await files.projectErrors(WORKSPACE)) as {
    errors: string[];
    diagnostics: unknown[];
  };
  // One message can list several nodes, an unresolved-reference list say, so it is split by line.
  const messages = [
    ...errors.flatMap((e) => e.split("\n")),
    ...diagnostics.map((d) => `diagnostic: ${JSON.stringify(d)}`),
  ];
  const each = cases.map((_, i) => messages.filter((m) => namesNode(m, i)));
  const rest = messages.filter(
    (m) => !cases.some((_, i) => namesNode(m, i)) && !/^\S.*:$/.test(m),
  );
  if (errors.length) return { each, rest };
  let doc: EngineDoc;
  try {
    doc = (await files.engineDoc(WORKSPACE)) as EngineDoc;
  } catch (e) {
    return { each, rest: [...rest, (e as Error).message] };
  }
  const plugins = doc.tracks.flatMap((t) => t.plugins);
  cases.forEach((c, i) => {
    const node = plugins.find((p) => p.name === `m${i}`);
    if (!node && !isOffline(resolvedText(c.dir)))
      each[i].push("no plugin in the engine document");
    const type = c.engine && expectedType(c);
    // An engine named wrong falls back to the default silently (packages/song/docs/engines.md), so the plugin says which ran.
    if (node && type && node.type !== type)
      each[i].push(`runs ${node.type}, not its engine's ${type}`);
  });
  return { each, rest };
}

/** Asserts no problem, or, for a module on KNOWN_BROKEN, that its bug still shows. */
function expectClean(c: Case, problems: string[]) {
  const bug = KNOWN_BROKEN[label(c)];
  if (!bug) {
    expect.soft(problems, label(c)).toEqual([]);
    return;
  }
  test.info().annotations.push({
    type: "known bug",
    description: `${label(c)}: ${bug}`,
  });
  expect
    .soft(problems, `${label(c)} passes now: drop it from KNOWN_BROKEN`)
    .not.toEqual([]);
}

function skip(c: Case, why: string) {
  test
    .info()
    .annotations.push({ type: "skipped", description: `${label(c)}: ${why}` });
}

/** The engine machine's log, the Logs panel's source, through the file service the page reaches. */
async function machineLog(page: Page): Promise<string[]> {
  return (await FileService.ofPage(page)).logs(WORKSPACE, 2000);
}

// From the log, not the page: the engine sends a build's warnings once, and a page connecting after the build never gets them.
async function buildWarnings(page: Page, name: string): Promise<string[]> {
  let built: string[] = [];
  await expect
    .poll(
      async () => {
        const lines = await machineLog(page);
        const from = lines.findIndex((l) => l.includes(`[project] '${name}'`));
        built = from < 0 ? [] : lines.slice(from);
        return built.some((l) => l.includes("[applied]"));
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  return built.filter((l) => /\bwarning: /.test(l));
}

let fresh = false;
// Remade by each worker's first test rather than a beforeAll: `k7` is a per-test fixture, and a failure replaces the worker.
async function scratch(files: FileService) {
  if (fresh) return;
  await files.removeWorkspace(WORKSPACE);
  await files.createWorkspace(WORKSPACE);
  fresh = true;
}

const CASES = libraryCases();
const FAMILIES = [...new Set(CASES.map((c) => c.family))].sort();

for (const family of FAMILIES) {
  const cases = CASES.filter((c) => c.family === family);

  test(`every ${family} module of @k7-core compiles`, async ({ k7 }) => {
    for (const c of cases) {
      const why = cannotCompile(c);
      if (why) skip(c, why);
    }
    const compiled = cases.filter((c) => !cannotCompile(c));
    if (!compiled.length) return;
    const files = await k7.files();
    await scratch(files);
    // One project for the family: an /open per module, hundreds in a row, has left the engine deaf to every later one.
    const { each, rest } = await compileProblems(
      files,
      `compile-${family}.k7`,
      compiled,
    );
    compiled.forEach((c, i) => {
      expectClean(c, each[i]);
    });
    expect.soft(rest, "messages naming no module").toEqual([]);
  });

  const loadable = cases.filter(
    (c) => !cannotLoad(c) && !KNOWN_BROKEN[label(c)],
  );
  if (!loadable.length) continue;
  test(`every ${family} module of @k7-core loads on the engine`, async ({
    k7,
  }) => {
    // A phone's engine logs to logcat, not to the machine log this reads (engine/k7-runtime/docs/android.md).
    test.skip(
      TARGET === "android",
      "a phone's engine log is not the machine log",
    );
    test.setTimeout(180_000);
    for (const c of cases) {
      const why = cannotLoad(c);
      if (why) skip(c, why);
    }
    const files = await k7.files();
    await scratch(files);
    const project = `all-${family}.k7`;
    // Named afresh each run, so the log's `[project] '<name>'` line is this build and no earlier one.
    const name = `library-${family}-${Date.now()}`;
    await writeProject(files, project, projectFiles(loadable, name));
    const page = await k7.open(`/@local/${WORKSPACE}/${project}`);
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeEnabled({ timeout: 120_000 });
    // The engine's warning ends `(for '<track>:<node>')`, the plugin id.
    const warnings = await buildWarnings(page, name);
    const ours = new Set<string>();
    loadable.forEach((c, i) => {
      const mine = warnings.filter((w) => w.includes(`:m${i}')`));
      for (const w of mine) ours.add(w);
      expect.soft(mine, `${label(c)} loads on the engine`).toEqual([]);
    });
    // The rest names no module of ours, a record outside the engine's folders say: noted, not failed on.
    for (const w of warnings.filter((x) => !ours.has(x)))
      test.info().annotations.push({ type: "noted", description: w });
    await expect(
      page.getByRole("img", { name: "engine connected" }),
    ).toBeVisible();
  });
}
