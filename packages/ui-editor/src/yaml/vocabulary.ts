// vocabulary.ts — the adapter between the schema-agnostic YAML editor and a studio project:
// it turns a file's path into a kind and asks @studio/song for that kind's fields and
// values. Derived rather than tabulated, because hand-kept field lists drift — a derived
// list cannot be behind its schema.
//
// It lives HERE, and not in an app, because three editors need the same answers: pistes'
// EditorPane, the médiathèque's, and the module builder's. It was copied between two of
// them, with a comment in each saying its real place was a package. This is that place —
// and the @studio/song it reaches for is pure Zod introspection, no node in it.

import type { FileKind } from "@studio/song/yaml/fields";
import { fieldsAt, fileKindFor, valuesAt } from "@studio/song/yaml/fields";
import type { Hints } from "@studio/web-protocol";
import type { YamlVocabulary } from "./completions";

/**
 * Values a position takes from THIS PROJECT rather than from its schema — a destination
 * names a module, and no enum can hold what the project happens to define.
 *
 * Here and not in @studio/song's fields.ts on purpose: that file is derived from the Zod
 * schemas and has to stay that way, while these come from the hints the server sends.
 */
function projectValues(
  kind: FileKind,
  keyPath: string[],
  field: string,
  hints: Hints,
): string[] {
  if (kind !== "chains") return [];
  // Inside `tracks:` or `modules:` the "field" is a NODE's name and the values are its
  // destinations — so the vocabulary is positional now rather than per field name. A
  // chain name is not among them: a bus is reached by naming the module it starts at, so
  // offering both spellings would have been two ways to write one arrow.
  const wiring = [...(hints.modules ?? []), ...(hints.ioSinks ?? [])];
  // A segment leaving a MODULE may also land on a track, which is how a live input is
  // wired: the input is the node the run starts at, and the track is where its signal
  // arrives. Not offered under `tracks:` — a track's signal never lands on another track.
  if (keyPath[0] === "modules")
    return [...new Set([...wiring, ...(hints.tracks ?? [])])];
  if (keyPath[0] === "tracks") return [...new Set(wiring)];
  // `bypassed` lists modules and nothing else — a track cannot be switched out of its
  // own chain, and a sink has nothing to pass through.
  if (field === "bypassed" || keyPath[0] === "bypassed")
    return hints.modules ?? [];
  return [];
}

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
        : projectValues(kind, keyPath, field, hints);
    },
  };
}
