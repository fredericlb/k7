// Does the documentation still describe the software? Two failures, both of which have happened: an example
// goes stale (caught by PARSING every example against the loader's own schema), and a field is added and never
// written down (caught by walking each schema's keys and asking whether any example mentions them).
// Both read the markdown under st0/docs/ itself. See ../../docs/docExamples.md.

import {
  ClipSchema,
  CurveSchema,
  SequenceSchema,
  VideoTrackSchema,
} from "@studio/song-schema/yaml/entitySchemas";
import { GraphFileSchema } from "@studio/song-schema/yaml/graphSchema";
import {
  ModuleConfigSchema,
  ModuleSchema,
  UiFileSchema,
} from "@studio/song-schema/yaml/moduleSchema";
import {
  ProjectFileSchema,
  SettingsSchema,
} from "@studio/song-schema/yaml/projectSchema";
import { SurfaceSchema } from "@studio/song-schema/yaml/surfaceSchema";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { z } from "zod";
import { DOC_EXAMPLES } from "./examples";

// The name an entity entry uses -> the schema the loader validates that file with. Same
// objects, not copies: a schema change is a test change, which is the point.
const SCHEMAS: Record<string, z.ZodType> = {
  ProjectFile: ProjectFileSchema,
  Settings: SettingsSchema,
  Surface: SurfaceSchema,
  // No `Track`: a lane is a NODE of a `@studio/…-track` module, so its examples declare
  // `schema=Module` like every other node. See packages/song/docs/trackModules.md.
  Clip: ClipSchema,
  Sequence: SequenceSchema,
  Curve: CurveSchema,
  VideoTrack: VideoTrackSchema,
  GraphFile: GraphFileSchema,
  Module: ModuleSchema,
  UiFile: UiFileSchema,
  ModuleConfig: ModuleConfigSchema,
};

describe("the documented file formats", () => {
  it("names a schema for every entry, or says why not", () => {
    // Without this an entry could dodge both checks by simply not declaring a schema.
    for (const e of DOC_EXAMPLES) {
      if (e.schema) {
        expect(
          SCHEMAS[e.schema],
          `${e.where}: unknown schema "${e.schema}"`,
        ).toBeDefined();
      } else {
        expect(
          e.exempt,
          `${e.where}: no schema and no exemption reason`,
        ).toBeTruthy();
      }
    }
  });

  for (const e of DOC_EXAMPLES.filter((x) => x.schema)) {
    it(`${e.where} is valid YAML the loader would accept`, () => {
      const parsed = parse(e.code, { version: "1.2" });
      const result = SCHEMAS[e.schema as string].safeParse(parsed);
      // The whole issue list, not just the first: a stale example is usually stale in
      // more than one place, and fixing them one test-run at a time is miserable.
      const why = result.success
        ? ""
        : result.error.issues
            .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("\n");
      expect(result.success, `${e.where}\n${why}`).toBe(true);
    });
  }
});

// Every top-level key a schema declares, for the coverage check below. Only object
// schemas have one to give; a union (a clip is audio or video, a track is one of three
// kinds) contributes the keys of every branch, since an example of any branch documents
// the field.
function topLevelKeys(schema: z.ZodType): string[] {
  const def = (schema as unknown as { def?: Record<string, unknown> }).def;
  if (!def) return [];
  if (def.type === "object")
    return Object.keys((def.shape ?? {}) as Record<string, unknown>);
  if (def.type === "union")
    return [
      ...new Set(
        ((def.options ?? []) as z.ZodType[]).flatMap((o) => topLevelKeys(o)),
      ),
    ];
  return [];
}

describe("documentation coverage", () => {
  // A field the schema accepts but no example mentions is a field nobody can discover
  // except by reading the source.
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    const examples = DOC_EXAMPLES.filter((e) => e.schema === name);
    if (!examples.length) continue;
    it(`${name}: every field appears in an example`, () => {
      // The prose counts as documentation too: a field is often explained in the
      // sentence above the block rather than shown in it.
      const text = examples.map((e) => `${e.code}\n${e.context}`).join("\n");
      const undocumented = topLevelKeys(schema).filter(
        (k) => !text.includes(k),
      );
      expect(undocumented, `undocumented ${name} fields`).toEqual([]);
    });
  }
});
