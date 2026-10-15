// surfaceRegistry.ts — the OPEN registry of surface types, seeded with the schema's four builtins.
// A plugin contributes one at composition time (file-service boot, or the shell's browser mount);
// nothing here imports plugin code, so song-schema stays the data-only tier everything may import.
// The Zod schema and the `SurfaceType` union stay the BUILTINS' for now — widening the parsed
// shape is the day a registered type actually ships (docs/k7-sdk/sdk.md).
// Full rationale: packages/k7-sdk/docs/sdk.md.

import {
  SURFACE_LAYOUTS_BY_TYPE,
  SURFACE_MAPPING_SKELETON,
  SURFACE_TYPES,
  type SurfaceLayout,
} from "./surfaceSchema";

/** One kind of surface a project may ask for: where it can be drawn, and what each of its
 *  components wants — the two tables the scaffolder and the completion provider both read. */
export interface SurfaceTypeContribution {
  type: string;
  layouts: readonly SurfaceLayout[];
  mappingSkeleton: readonly (readonly [string, string])[];
}

const registry = new Map<string, SurfaceTypeContribution>();
for (const type of SURFACE_TYPES)
  registry.set(type, {
    type,
    layouts: SURFACE_LAYOUTS_BY_TYPE[type],
    mappingSkeleton: SURFACE_MAPPING_SKELETON[type],
  });

/** Contribute a surface type. A builtin's name is not free: the seed is the vocabulary, and one
 *  plugin must not redefine what another declared. No layouts, no mount — refused up front. */
export function registerSurfaceType(c: SurfaceTypeContribution): void {
  if (registry.has(c.type))
    throw new Error(
      `surface type '${c.type}' is already registered${(SURFACE_TYPES as readonly string[]).includes(c.type) ? " (it is a builtin)" : ""}`,
    );
  if (c.layouts.length === 0)
    throw new Error(`surface type '${c.type}' declares no layout`);
  registry.set(c.type, c);
}

/** Every kind a project may declare, registered order first — what `project surface new` offers. */
export function allSurfaceTypes(): readonly string[] {
  return [...registry.keys()];
}

/** One kind, or undefined — the shape a scaffolder and a parser both ask for. */
export function surfaceTypeOf(
  type: string,
): SurfaceTypeContribution | undefined {
  return registry.get(type);
}
