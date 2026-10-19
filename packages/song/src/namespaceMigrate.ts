// namespaceMigrate.ts — rewrite the default library's old module levels, `@mediatek/…` and `@st0/…` →
// `@k7-core/…`, the modules k7-core renamed (`st0-rack`, `st0-4osc`), the `st0` pin of `_library-pins.k7x` and
// the namespace of a `config.k7x`, in every .k7x under a folder; a legacy `_library-pins.yaml` or `library.yaml`
// met on the way is upgraded to its .k7x first. Idempotent: a folder done already changes nothing.
// Why the refs are a text replace and not a document edit: docs/moduleNamespaces.md.

import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { K7Document } from "@studio/k7x/document";
import { isDocFile } from "@studio/song-schema/docExt";
import {
  LIBRARY_MANIFEST,
  LIBRARY_PINS_FILE,
  stringifyLibraryManifest,
  stringifyLibraryPins,
} from "@studio/song-schema/libraryVersions";
import {
  LEGACY_LIBRARY_MANIFEST,
  LEGACY_LIBRARY_PINS_FILE,
  parseLegacyLibraryManifest,
  parseLegacyLibraryPins,
} from "@studio/song-schema/libraryVersionsLegacy";
import {
  DEFAULT_LIBRARY,
  LEGACY_DEFAULT_LIBRARY,
  LEGACY_MEDIATEK_NS,
} from "@studio/song-schema/moduleTypes";
import { writeFileAtomic } from "./atomicWrite";

const FROM = [`@${LEGACY_MEDIATEK_NS}/`, `@${LEGACY_DEFAULT_LIBRARY}/`];
const TO = `@${DEFAULT_LIBRARY}/`;
const OLD_NAMESPACES = new Set([LEGACY_MEDIATEK_NS, LEGACY_DEFAULT_LIBRARY]);
// A module folder's config, whose `namespace` must not contradict the loader even though nothing reads it back.
const CONFIG_FILE = "config.k7x";
// The modules the library itself renamed with it; bounded, so a longer name sharing the start is left alone.
const RENAMED = new RegExp(
  `@${DEFAULT_LIBRARY}/instruments/st0-(rack|4osc)(?![A-Za-z0-9-])`,
  "g",
);

/** `text` with the root key edits a config or pins file needs, and how many were made; a text that does not read is left as is. */
function rootKeyEdits(
  file: string,
  text: string,
): { text: string; hits: number } {
  const name = basename(file);
  if (name !== CONFIG_FILE && name !== LIBRARY_PINS_FILE)
    return { text, hits: 0 };
  const doc = new K7Document(text);
  if (doc.errors.length) return { text, hits: 0 };
  if (name === CONFIG_FILE) {
    const ns = doc.getIn(["namespace"]);
    if (typeof ns !== "string" || !OLD_NAMESPACES.has(ns))
      return { text, hits: 0 };
    doc.setIn(["namespace"], DEFAULT_LIBRARY);
    return { text: doc.toString(), hits: 0 };
  }
  // A pin is keyed by the library's name, so the old name pins a library that no longer exists.
  if (!doc.hasIn([LEGACY_DEFAULT_LIBRARY])) return { text, hits: 0 };
  if (doc.hasIn([DEFAULT_LIBRARY])) doc.deleteIn([LEGACY_DEFAULT_LIBRARY]);
  else doc.renameKey([LEGACY_DEFAULT_LIBRARY], DEFAULT_LIBRARY);
  return { text: doc.toString(), hits: 1 };
}

/** k7x `text` with every old spelling rewritten, and how many refs that was. */
export function migrateNamespaceText(
  file: string,
  text: string,
): { after: string; hits: number } {
  let after = text;
  let hits = 0;
  for (const from of FROM) {
    hits += after.split(from).length - 1;
    after = after.split(from).join(TO);
  }
  after = after.replace(RENAMED, (_m, name: string) => {
    hits++;
    return `@${DEFAULT_LIBRARY}/instruments/k7-${name}`;
  });
  const keyed = rootKeyEdits(file, after);
  return { after: keyed.text, hits: hits + keyed.hits };
}

/** The k7x text a legacy pins or manifest file upgrades to, or null when it is not one this reads. */
function legacyUpgrade(file: string): { to: string; text: string } | null {
  const yaml = readFileSync(file, "utf8");
  if (basename(file) === LEGACY_LIBRARY_PINS_FILE)
    return {
      to: join(dirname(file), LIBRARY_PINS_FILE),
      text: stringifyLibraryPins(parseLegacyLibraryPins(yaml)),
    };
  const manifest = parseLegacyLibraryManifest(yaml);
  return manifest
    ? {
        to: join(dirname(file), LIBRARY_MANIFEST),
        text: stringifyLibraryManifest(manifest),
      }
    : null;
}

const isLegacy = (name: string): boolean =>
  name === LEGACY_LIBRARY_PINS_FILE || name === LEGACY_LIBRARY_MANIFEST;

/** Every .k7x and legacy pins or manifest under `dir`, skipping what a project did not author and what is hidden (a backup, sync state). */
function* sourceFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith(".") || name === "node_modules" || name === "_history")
      continue;
    const p = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* sourceFiles(p);
    else if (isDocFile(name) || isLegacy(name)) yield p;
  }
}

/** Rewrite every file under `dir` that still says an old spelling or is still YAML; dry unless `write`. Answers each file changed. */
export function migrateNamespaceIn(
  dir: string,
  write: boolean,
): { file: string; hits: number }[] {
  const out: { file: string; hits: number }[] = [];
  for (const file of sourceFiles(dir)) {
    if (isLegacy(basename(file))) {
      const up = legacyUpgrade(file);
      // A .k7x already beside it is the one every reader reads, so the YAML is only removed.
      if (!up || existsSync(up.to)) {
        if (up && write) rmSync(file, { force: true });
        continue;
      }
      const { after, hits } = migrateNamespaceText(up.to, up.text);
      out.push({ file: up.to, hits });
      if (write) {
        writeFileAtomic(up.to, after);
        rmSync(file, { force: true });
      }
      continue;
    }
    const before = readFileSync(file, "utf8");
    const { after, hits } = migrateNamespaceText(file, before);
    if (after === before) continue;
    out.push({ file, hits });
    if (write) writeFileAtomic(file, after);
  }
  return out;
}
