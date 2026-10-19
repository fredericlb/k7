// vocabulary.ts — the adapter between the schema-agnostic completion and a studio project: a file's path becomes a
// kind, and @studio/song-schema answers that kind's fields and values, derived so they cannot fall behind the schema.
// Shared by k7's EditorPane, YamlPane and the module builder; the k7x and YAML modes both read it (docs/completion.md).

import { docPattern } from "@studio/song-schema/docExt";
import { isEngineRef } from "@studio/song-schema/moduleTypes";
import type { FileKind } from "@studio/song-schema/yaml/fields";
import {
  fieldsAt,
  fileKindFor,
  valuesAt,
} from "@studio/song-schema/yaml/fields";
import type { Hints } from "@studio/web-protocol";
import type { YamlVocabulary } from "./completions";

/** Values a position takes from THIS PROJECT rather than from its schema, off the hints — see docs/completion.md. */
function projectValues(
  kind: FileKind,
  keyPath: string[],
  field: string,
  hints: Hints,
  path: string,
): string[] {
  // What a module may EXTEND — a scanned `@engine` plugin only from a LIBRARY's module, never a project's node.
  if (kind === "module")
    return !keyPath.length && field === "extends"
      ? (hints.baseModules ?? []).filter(
          (r) => !isNodeFile(path) || !isEngineRef(r),
        )
      : [];
  // A chain file's node is a project's use too, and a lane item names one of the project's lanes.
  if (kind === "chain") {
    if (keyPath.length !== 1 || keyPath[0] !== "steps") return [];
    if (field === "extends")
      return (hints.baseModules ?? []).filter((r) => !isEngineRef(r));
    return field === "track" ? (hints.tracks ?? []) : [];
  }
  if (kind !== "chains") return [];
  // Inside `tracks:` or `modules:` the "field" is a NODE's name and the values are its destinations.
  const wiring = [...(hints.modules ?? []), ...(hints.ioSinks ?? [])];

  // A segment leaving a MODULE may also land on a track, which is how a live input is wired.
  if (keyPath[0] === "modules")
    return [...new Set([...wiring, ...(hints.tracks ?? [])])];
  if (keyPath[0] === "tracks") return [...new Set(wiring)];
  // `bypassed` lists modules and nothing else, for the reason in docs/completion.md.
  if (field === "bypassed" || keyPath[0] === "bypassed")
    return hints.modules ?? [];
  return [];
}

/** A project's use of a module, `nodes/<name>.k7x` or a lane's `tracks/<name>.k7x` — it reaches a scanned plugin through its library face. */
const NODE_FILE = docPattern("(^|/)(nodes|tracks)/[^/]+", "");
const isNodeFile = (path: string): boolean =>
  NODE_FILE.test(path.replace(/\\/g, "/"));

/** The vocabulary for the file at `path`. Offers nothing for a file that isn't ours. */
export function schemaVocabulary(path?: string, hints?: Hints): YamlVocabulary {
  const kind = fileKindFor(path);
  if (!kind) return { fieldsAt: () => [] };
  return {
    fieldsAt: (keyPath) => fieldsAt(kind, keyPath),
    valuesAt: (keyPath, field) => {
      const schema = valuesAt(kind, keyPath, field);
      return schema.length || !hints
        ? schema
        : projectValues(kind, keyPath, field, hints, path ?? "");
    },
  };
}
