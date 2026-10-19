// presets.ts — a module's named settings, one FILE each, in a `presets/` tree beside the modules
// rather than in the module's folder: `<presets>/<ns>/<module path>/<name>.k7x`. The tree's root is
// where it is KEPT (the workspace or a library); the path is which module it is FOR. No node:fs here,
// so the browser shares the vocabulary. See packages/song/docs/userPresets.md.

import { stringify } from "@studio/k7x/print";
import { z } from "zod";

/** The workspace's preset tree, beside `_modules/` — the `@workspace` level's spelling. */
export const SHARED_PRESETS_DIR = "_presets";

/** …and a library's, a family of the repository like `modules/` and `chains/`. */
export const LIBRARY_PRESETS_DIR = "presets";

/** Where a preset is kept: `workspace`, or the name of one of the account's libraries. */
export type PresetScope = string;

export const WORKSPACE_SCOPE: PresetScope = "workspace";

/** One preset as a listing names it: where it is kept, and its name. */
export interface PresetEntry {
  scope: PresetScope;
  name: string;
}

/** What a node offers: the module ref its presets are keyed by, those presets, and where a new one may go. */
export interface NodePresets {
  ref: string | null;
  presets: PresetEntry[];
  scopes: PresetScope[];
}

/** The level a project's own samples answer to — a sample a preset may not keep, being one project's. */
export const PROJECT_SAMPLE_PREFIX = "@project/";

/** A preset's name is its file's name, so it is held to what every filesystem agrees on. */
export const PRESET_NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;

/** `@k7-core/instruments/synth` → `k7-core/instruments/synth`, the folder its presets sit in; null for a ref that has no such path. */
export function presetModulePath(ref: string): string | null {
  const m = /^@(.+)$/.exec(ref);
  if (!m) return null;
  const segs = m[1].split("/");
  return segs.length >= 2 && segs.every((s) => SEGMENT.test(s))
    ? segs.join("/")
    : null;
}

/** One pad of a rack's kit, as a preset keeps it: a note and a LIBRARY sample, never a project's. */
const PresetTapSchema = z
  .object({
    note: z.number().int().min(0).max(127),
    sample: z.string().min(1).optional(),
  })
  .strict();

/** One preset file: the values it sets, the engine they were taken on, and a rack's kit. */
export const PresetFileSchema = z
  .object({
    engine: z.string().min(1).optional(),
    // The named base the values were taken on — a whole state they only make sense over (packages/song/docs/userPresets.md).
    base: z.string().min(1).optional(),
    params: z.record(z.string().min(1), z.number()).optional(),
    rack: z.record(z.string().min(1), PresetTapSchema).optional(),
  })
  .strict();

export type PresetFile = z.infer<typeof PresetFileSchema>;

/** A preset as k7x text, headed by the module it is for; a rack's pad stays on one line, the way a node's file writes its taps. */
export function presetFileText(ref: string, preset: PresetFile): string {
  const { engine, base, params, rack } = PresetFileSchema.parse(preset);
  return stringify(
    { engine, base, params, rack },
    {
      header: [`preset for ${ref}`],
      inline: (path) => path.length === 2 && path[0] === "rack",
    },
  );
}
