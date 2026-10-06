// vocabulary.ts — the adapter between the schema-agnostic YAML editor and a studio project:
// it turns a file's path into a kind and asks @studio/song-schema for that kind's fields and
// values. Derived rather than tabulated, because hand-kept field lists drift — a derived
// list cannot be behind its schema.
//
// It lives HERE, and not in an app, because three editors need the same answers: st0's
// EditorPane, the médiathèque's, and the module builder's. What it reaches for is pure
// Zod introspection, no node in it.

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

/** A project's use of a module, `nodes/<name>.yaml` or a lane's `tracks/<name>.yaml` — it reaches a scanned plugin through its library face. */
const isNodeFile = (path: string): boolean =>
  /(^|\/)(nodes|tracks)\/[^/]+\.ya?ml$/.test(path.replace(/\\/g, "/"));

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
