// collect.ts — builds the third-party notices: the npm production closure of every shipped app, walked
// on disk, plus the hand list of what npm does not install (components.json). See ../docs/about.md.
// A workspace package is OURS and is walked through, never listed; only node_modules entries are third party.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { NoticeEntry, Notices, Where } from "./types.ts";

/** The shipped apps, as workspace folders whose `dependencies` reach a user, and where each ships. */
export const NPM_ROOTS: { dir: string; where: Where }[] = [
  { dir: "apps/k7/frontend", where: "web" },
  { dir: "apps/k7/backend", where: "server" },
  // The tray ships the backend bundle, the frontend inside it, to a computer (apps/k7-tray/scripts/stage.mjs).
  { dir: "apps/k7/backend", where: "desktop" },
  { dir: "apps/k7/frontend", where: "desktop" },
  { dir: "engine/k7-android/web", where: "android" },
  // Bundled into the engine binary as strudel.bundle.js (engine/k7-runtime/docs/patternPlugin.md).
  { dir: "packages/song-strudel", where: "engine" },
];

/** Licences a GPLv3 program cannot take in, or must not without a reading of its own. */
const INCOMPATIBLE =
  /\b(GPL-2\.0-only|GPL-2\.0(?![-+\w])|LGPL-2\.0-only|SSPL|BUSL|Commons-Clause|CC-BY-NC|JSON|EPL-1\.0|CDDL|UNLICENSED|SEE LICENSE)/;

/** One hand-listed component (components.json). */
export interface Component {
  name: string;
  version?: string | null;
  /** `termux:<pkg>` or `package:<dir>#<dep>`: the version is read there, never copied by hand. */
  versionFrom?: string;
  license: string;
  url: string;
  where: Where[];
  /** A file under texts/ holding its own notice, copyright lines included. */
  text?: string;
  /** Where its licence text ships BESIDE it, when that text is too large or too varied to carry here. */
  shipped?: string;
  /** What vendor.ts copies into `text` from an engine build's `_deps` or the tree. */
  vendor?: string[];
  note?: string;
  /** The FetchContent names, termux packages, apk and apt packages it accounts for: the test's anti-rot keys. */
  fetchContent?: string[];
  termux?: string[];
  apk?: string[];
  apt?: string[];
  /** The file its pinned version is written in: the test checks the version is still there. */
  source?: string;
}

export interface ComponentsFile {
  /** npm packages whose manifest names no licence, checked by hand, with why. */
  npmOverrides: Record<string, { license: string; reason: string }>;
  components: Component[];
}

export interface Collected {
  notices: Notices;
  /** A production dependency with no licence anyone can name: the build ships nothing it cannot account for. */
  errors: string[];
  /** Worth a human's look — a licence GPLv3 may not take, a package shipping no licence file. */
  warnings: string[];
}

interface Manifest {
  name: string;
  version: string;
  license?: string | { type?: string };
  licenses?: { type?: string }[];
  repository?: string | { url?: string };
  homepage?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T;

/** Node's lookup: `<dir>/node_modules/<name>`, then each parent up to the repo root. */
function resolvePackage(from: string, name: string, root: string) {
  let dir = from;
  for (;;) {
    const candidate = join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) return dirname(realpathSync(candidate));
    if (dir === root || dirname(dir) === dir) return null;
    dir = dirname(dir);
  }
}

/** Spellings manifests use for an SPDX id, read as that id. */
const SPDX_SPELLINGS: Record<string, string> = {
  "MPL 2.0": "MPL-2.0",
  "Apache 2.0": "Apache-2.0",
  "Apache License 2.0": "Apache-2.0",
  "Apache License, Version 2.0": "Apache-2.0",
  BSD: "BSD-3-Clause",
};

/** The manifest's licence as one SPDX expression, or null when it names none. */
export function licenseOf(pkg: Manifest): string | null {
  const raw =
    typeof pkg.license === "string"
      ? pkg.license.trim()
      : (pkg.license?.type ?? null);
  if (raw) return SPDX_SPELLINGS[raw] ?? raw;
  const types = (pkg.licenses ?? []).flatMap((l) => (l.type ? [l.type] : []));
  if (types.length > 1) return `(${types.join(" OR ")})`;
  return types[0] ?? null;
}

const LICENSE_FILE =
  /^(licen[cs]e|copying|notice)([-._].*)?(\.(md|txt|markdown))?$/i;

/** The package's own licence and NOTICE files, concatenated: an Apache NOTICE travels with the licence. */
export function licenseText(dir: string): string | null {
  const files = readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f))
    .sort(
      (a, b) =>
        Number(/notice/i.test(a)) - Number(/notice/i.test(b)) ||
        a.localeCompare(b),
    );
  const texts = files.map((f) => readFileSync(join(dir, f), "utf8").trim());
  return texts.length ? texts.join("\n\n") : null;
}

/** The SPDX ids an expression names, folded onto the standard texts' keys (`GPL-3.0-only` → `GPL-3.0`). */
export function standardIds(expr: string, known: Set<string>): string[] {
  const ids = expr.match(/[A-Za-z0-9][A-Za-z0-9.+-]*/g) ?? [];
  const keys = ids
    .filter((id) => !/^(AND|OR|WITH)$/.test(id))
    .map((id) => id.replace(/(-only|-or-later|\+)$/, ""));
  return [...new Set(keys.filter((k) => known.has(k)))];
}

function repoUrl(pkg: Manifest): string | null {
  const raw =
    typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const url = raw
    ?.replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/\.git$/, "")
    .replace(/^github:/, "https://github.com/");
  if (url && /^https?:\/\//.test(url)) return url;
  if (url && /^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
  return pkg.homepage ?? null;
}

/** Text → key, each distinct text stored once. */
function textStore() {
  const texts: Record<string, string> = {};
  return {
    texts,
    put(text: string): string {
      const key = createHash("sha256").update(text).digest("hex").slice(0, 12);
      texts[key] = text;
      return key;
    },
  };
}

/** Every third-party npm package the shipped apps' `dependencies` reach, keyed by name@version. */
export function walkNpm(root: string, roots = NPM_ROOTS) {
  const found = new Map<
    string,
    { dir: string; pkg: Manifest; where: Set<Where> }
  >();
  const seen = new Set<string>();
  const queue: { dir: string; where: Where }[] = roots.map((r) => ({
    dir: join(root, r.dir),
    where: r.where,
  }));
  for (let next = queue.shift(); next; next = queue.shift()) {
    const { dir, where } = next;
    if (seen.has(`${where}|${dir}`)) continue;
    seen.add(`${where}|${dir}`);
    const pkg = readJson<Manifest>(join(dir, "package.json"));
    const ours = !relative(root, dir).split(sep).includes("node_modules");
    if (!ours) {
      const id = `${pkg.name}@${pkg.version}`;
      const entry = found.get(id) ?? { dir, pkg, where: new Set<Where>() };
      entry.where.add(where);
      found.set(id, entry);
    }
    const names = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ]);
    for (const name of names) {
      const next = resolvePackage(dir, name, root);
      // An optional or peer dependency this platform did not install is not shipped from here.
      if (next) queue.push({ dir: next, where });
    }
  }
  return found;
}

/** `termux:<pkg>` reads engine/k7-android's pin; `package:<dir>#<dep>` a manifest's own range. */
export function resolveVersion(root: string, from: string): string | null {
  const [kind, ref = ""] = from.split(/:(.*)/s);
  if (kind === "termux") {
    const pins = readJson<Record<string, { version: string }>>(
      join(root, "engine/k7-android/scripts/termux-packages.json"),
    );
    return pins[ref]?.version ?? null;
  }
  if (kind === "package") {
    const [dir = "", dep = ""] = ref.split("#");
    const pkg = readJson<
      Manifest & { devDependencies?: Record<string, string> }
    >(join(root, dir, "package.json"));
    return pkg.dependencies?.[dep] ?? pkg.devDependencies?.[dep] ?? null;
  }
  return null;
}

/** The dataset the About page loads, from the repo at `root` and the notices folder at `here`. */
export function collect(
  root: string,
  { here = join(root, "apps/k7/frontend/notices"), roots = NPM_ROOTS } = {},
): Collected {
  const errors: string[] = [];
  const warnings: string[] = [];
  const file = readJson<ComponentsFile>(join(here, "components.json"));
  const standards: Record<string, string> = {};
  // GPL-3.0 is k7's own licence: the root LICENSE is that text, never a second copy of it.
  standards["GPL-3.0"] = readFileSync(join(root, "LICENSE"), "utf8");
  for (const f of readdirSync(join(here, "licenses")))
    standards[f.replace(/\.txt$/, "")] = readFileSync(
      join(here, "licenses", f),
      "utf8",
    );
  const known = new Set(Object.keys(standards));
  const store = textStore();
  const entries: NoticeEntry[] = [];

  for (const { dir, pkg, where } of walkNpm(root, roots).values()) {
    const override = file.npmOverrides[pkg.name];
    const license = licenseOf(pkg) ?? override?.license ?? null;
    if (!license) {
      errors.push(
        `${pkg.name}@${pkg.version} names no licence (add it to npmOverrides once checked)`,
      );
      continue;
    }
    if (INCOMPATIBLE.test(license))
      warnings.push(
        `${pkg.name}@${pkg.version} is ${license}: check it against GPLv3`,
      );
    const text = licenseText(dir);
    const ids = standardIds(license, known);
    if (!text && !ids.length)
      warnings.push(
        `${pkg.name}@${pkg.version} (${license}) ships no licence file`,
      );
    entries.push({
      name: pkg.name,
      version: pkg.version,
      license,
      url: repoUrl(pkg),
      where: [...where].sort(),
      text: text ? store.put(text) : null,
      standards: ids,
    });
  }

  for (const c of file.components) {
    const version = c.versionFrom
      ? resolveVersion(root, c.versionFrom)
      : (c.version ?? null);
    if (c.versionFrom && !version)
      errors.push(`${c.name}: ${c.versionFrom} names no version`);
    const ids = standardIds(c.license, known);
    const text = c.text
      ? readFileSync(join(here, "texts", c.text), "utf8")
      : null;
    if (!text && !ids.length && !c.shipped)
      errors.push(
        `${c.name} (${c.license}) has no notice, standard text or shipped text`,
      );
    entries.push({
      name: c.name,
      version,
      license: c.license,
      url: c.url,
      where: [...c.where].sort(),
      text: text ? store.put(text) : null,
      standards: ids,
      ...(c.note ? { note: c.note } : {}),
      ...(c.shipped ? { shipped: c.shipped } : {}),
    });
  }

  entries.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      (a.version ?? "").localeCompare(b.version ?? ""),
  );
  // Only the standard texts something names: the page carries no licence nobody uses.
  const used = new Set(entries.flatMap((e) => e.standards));
  used.add("GPL-3.0");
  const kept = Object.fromEntries(
    Object.entries(standards).filter(([k]) => used.has(k)),
  );
  return {
    notices: { entries, texts: store.texts, standards: kept },
    errors,
    warnings,
  };
}
