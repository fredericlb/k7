// projectShapes.ts — the archetypes a project is created as, importing nothing.
// Apart from yaml/projectSchema.ts so the home page's new-project menu does not load zod to list five words.

/** The ARCHETYPES: three named after the surface they open on, the two `live` ones after what they are (docs/projectFile.md). */
export const PROJECT_SHAPES = [
  "arrangement",
  "mix",
  "video",
  "live",
  "live-video",
] as const;
export type ProjectShape = (typeof PROJECT_SHAPES)[number];
