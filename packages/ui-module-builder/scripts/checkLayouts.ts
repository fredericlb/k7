// checkLayouts.ts — every library module's panel against the two-layout rules (src/layoutTwins.ts) and the
// AI brief's checks, and against what it offered BEFORE: a migrated panel must keep every control the
// committed one had, wherever it moved. Usage: tsx scripts/checkLayouts.ts [module dirs…] (default: all of
// k7-core). Exits 1 on any issue. See docs/layouts.md.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parse as parseK7x } from "@studio/k7x/document";
import {
  type ModuleUI,
  UiFileSchema,
  type Widget,
} from "@studio/song-schema/yaml/moduleSchema";
import { parse as parseYaml } from "yaml";
import {
  atControlIssues,
  eqBandIssues,
  loneGroupIssues,
} from "../src/aiOrganize";
import { gridIssues, twinIssues } from "../src/layoutTwins";

const LIBRARY = resolve(import.meta.dirname, "../../../k7-core");

/** A panel's data, read by its extension: a ui.k7x or a ui.yaml (packages/k7x/docs/language.md). */
const parse = (text: string, file: string): unknown =>
  file.endsWith(".k7x") ? parseK7x(text) : parseYaml(text);

/** A module folder's panel file, the .k7x spelling first as the loader reads it. */
const panelIn = (dir: string): string =>
  existsSync(join(dir, "ui.k7x")) ? join(dir, "ui.k7x") : join(dir, "ui.yaml");

/** Every ui.k7x or ui.yaml under the library, or the ones named. */
function targets(args: string[]): string[] {
  if (args.length) return args.map((a) => panelIn(resolve(a)));
  const out = execFileSync(
    "git",
    ["-C", LIBRARY, "ls-files", "*ui.yaml", "*ui.k7x"],
    { encoding: "utf8" },
  );
  return [
    ...new Set([
      ...out
        .split("\n")
        .filter(Boolean)
        .map((f) => join(LIBRARY, f)),
      ...execFileSync(
        "find",
        [join(LIBRARY, "modules"), "-name", "ui.yaml", "-o", "-name", "ui.k7x"],
        { encoding: "utf8" },
      )
        .split("\n")
        .filter(Boolean),
    ]),
  ].filter((f) => existsSync(f));
}

/** Every control a panel offers, all its pages and both its shapes: binds counted, frames and labels aside. */
function offers(ui: Pick<ModuleUI, "widgets" | "tabs">): Set<string> {
  const all = [
    ...Object.values(ui.widgets),
    ...(ui.tabs ?? []).flatMap((t) => Object.values(t.widgets)),
  ];
  return new Set(
    all
      .filter((w) => w.bind && w.type !== "group" && w.type !== "label")
      .map((w) => w.bind as string),
  );
}

/** The committed panel, if the library's HEAD has one — what the migration must not lose. */
function committed(file: string): ModuleUI | null {
  try {
    const text = execFileSync(
      "git",
      ["-C", LIBRARY, "show", `HEAD:${relative(LIBRARY, file)}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const r = UiFileSchema.safeParse(parse(text, file));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

function pagesOf(
  layout: Pick<ModuleUI, "widgets" | "tabs">,
): [string, [string, Widget][]][] {
  const top = Object.entries(layout.widgets);
  if (!layout.tabs?.length) return [["panel", top]];
  return layout.tabs.map((t) => [
    `tab ${t.name}`,
    [...top, ...Object.entries(t.widgets)],
  ]);
}

/** The screen ids a widgets.js draws, run as the renderer runs it (ui-chains' lcdScreen.ts): `export default` becomes a return. */
function screensOf(source: string): Set<string> {
  if (!source.trim()) return new Set();
  try {
    const out = new Function(
      `"use strict";\n${source.replace(/\bexport\s+default\b/, "return ")}`,
    )() as Record<string, unknown> | undefined;
    return new Set(Object.keys(out ?? {}));
  } catch {
    return new Set();
  }
}

function check(file: string): string[] {
  let raw: unknown;
  try {
    raw = parse(readFileSync(file, "utf8"), file);
  } catch (e) {
    return [`unreadable: ${(e as Error).message}`];
  }
  const r = UiFileSchema.safeParse(raw);
  if (!r.success)
    return r.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
    );
  const ui = r.data;
  const issues = [...twinIssues(ui)];
  for (const [where, ws] of pagesOf(ui))
    issues.push(...gridIssues(ui, where, ws));
  // The brief's structural rules, in BOTH shapes.
  for (const layout of [ui, ...(ui.vertical ? [ui.vertical] : [])])
    for (const [, ws] of pagesOf(layout)) {
      issues.push(...atControlIssues(ws));
      issues.push(...eqBandIssues(ws));
    }
  issues.push(...loneGroupIssues(Object.entries(ui.widgets)));
  for (const t of ui.tabs ?? [])
    issues.push(...loneGroupIssues(Object.entries(t.widgets)));
  const before = committed(file);
  if (before) {
    const now = offers(ui);
    // An `@` control is one the brief forbids, so dropping it is the fix rather than a loss.
    const lost = [...offers(before)].filter(
      (b) => !now.has(b) && !b.startsWith("@"),
    );
    if (lost.length)
      issues.push(
        `controls the committed panel had are gone: ${lost.map((b) => `\`${b}\``).join(", ")}`,
      );
  }
  // Every screen needs its draw function in the panel's widgets.js — asked of the COMPILED script, whose keys may be built.
  const js = join(dirname(file), "widgets.js");
  const drawn = screensOf(existsSync(js) ? readFileSync(js, "utf8") : "");
  for (const layout of [ui, ...(ui.vertical ? [ui.vertical] : [])])
    for (const [, ws] of pagesOf(layout))
      for (const [id, w] of ws)
        if (w.type === "lcdscreen" && !drawn.has(id))
          issues.push(`screen \`${id}\` has no draw function in widgets.js`);
  return [...new Set(issues)];
}

const files = targets(process.argv.slice(2));
let bad = 0;
for (const f of files) {
  const issues = check(f);
  if (!issues.length) continue;
  bad++;
  console.log(`✗ ${relative(LIBRARY, dirname(f))}`);
  for (const i of issues) console.log(`    ${i}`);
}
console.log(`${files.length - bad}/${files.length} panels pass`);
process.exit(bad ? 1 : 0);
