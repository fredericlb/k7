// chainSchema.ts — a `chains/<name>.yaml` file's shape. A chain is a list of STEPS: a node, a lane,
// several nodes side by side, and last the chains its signal goes on to. Nodes are unnamed and carry
// an `id`; a node item's own fields are a module's and are vetted by parseModule. See docs/chainFiles.md.

import { z } from "zod";

/** The folder a chain project keeps its chains in, one file per chain — its presence IS the format. */
export const CHAINS_DIR = "chains";
/** A lane's own file — events and alternatives — named by the lane, and pointed at by a track item. */
export const TRACKS_DIR = "tracks";
/** Every node's opaque plugin state, named by the node's `vstpreset:` (default `<id>.vstpreset`). */
export const VSTPRESETS_DIR = "vstpresets";
/** The files a node's params name, resolved against the project root as `assets/<ref>`. */
export const ASSETS_DIR = "assets";
/** Where cards SIT on the graph — cosmetic, keyed by node id, lane name or built-in. */
export const LAYOUT_FILE = "layout.yaml";

/** The sums a chain may START at rather than at a source node of its own. */
export const CHAIN_STARTS = ["MIX", "RENDER"] as const;
/** The built-in ends a link may name beside another chain; `@out` is a library template's, docs/sharedFolders.md. */
export const CHAIN_SINKS = [
  "OUT",
  "MIX",
  "RENDER",
  "VIDEO_OUT",
  "CUE",
  "@out",
] as const;

/** The keys a node item carries that a module file does not — stripped before parseModule sees it. */
export const NODE_ITEM_KEYS = ["id", "bypass", "vstpreset", "mapping"] as const;

const Id = z.string().min(1);

/** A lane in the chain: its events live in `tracks/<track>.yaml`, and its bypass is its mute. */
export const TrackItemSchema = z
  .object({ id: Id, track: z.string().min(1), bypass: z.boolean().optional() })
  .strict();

/** A node: a module's fields, plus the four a use adds — the rest is checked by parseModule. */
export const NodeItemSchema = z
  .object({
    id: Id,
    bypass: z.boolean().optional(),
    vstpreset: z.string().min(1).optional(),
    mapping: z.string().min(1).optional(),
  })
  .passthrough();

export const ItemSchema = z.union([TrackItemSchema, NodeItemSchema]);

/** Where the signal goes once the chain ends: another chain (a port of it) or a built-in end. */
export const LinkSchema = z
  .object({
    chain: z.string().min(1),
    level: z.number().nonnegative().optional(),
    port: z.string().min(1).optional(),
  })
  .strict();

/** The LAST step: links only, never mixed with nodes. Several links each carry a level. */
export const EndStepSchema = z
  .object({ to: z.array(LinkSchema).min(1) })
  .strict()
  .refine((s) => s.to.length < 2 || s.to.every((l) => l.level !== undefined), {
    message: "a step linking several chains gives each link a `level`",
  });

export const StepSchema = z.union([
  EndStepSchema,
  z.array(ItemSchema).min(2),
  ItemSchema,
]);

export const ChainFileSchema = z
  .object({
    // `true`: the chain starts at its own first node (a source); `MIX`/`RENDER`: at that sum. Absent: fed by links.
    start: z.union([z.literal(true), z.enum(CHAIN_STARTS)]).optional(),
    // A chain WITHOUT a start names the ports it is linked into; each feeds its first node's input of that name.
    ports: z.array(z.string().min(1)).optional(),
    // Heard only through what it links to, its dry path to the sum removed — docs/busOnly.md.
    bus_only: z.boolean().optional(),
    steps: z.array(StepSchema).default([]),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.start !== undefined && c.ports?.length)
      ctx.addIssue({
        code: "custom",
        path: ["ports"],
        message:
          "a chain with a start is linked into by nothing, so it has no ports",
      });
    if (Array.isArray(c.steps[0]))
      ctx.addIssue({
        code: "custom",
        path: ["steps", 0],
        message:
          "the first step is one node — its ports are what the chain is linked into",
      });
    c.steps.forEach((s, i) => {
      if (isEndStep(s) && i !== c.steps.length - 1)
        ctx.addIssue({
          code: "custom",
          path: ["steps", i],
          message: "a step of links ends the chain — it can only be the last",
        });
    });
    if (c.start !== true && c.steps.some((s) => itemsOf(s).some(isTrackItem)))
      ctx.addIssue({
        code: "custom",
        path: ["steps"],
        message:
          "a lane is a source: only a chain with `start: true` holds one",
      });
  });

export type TrackItem = z.infer<typeof TrackItemSchema>;
export type NodeItem = z.infer<typeof NodeItemSchema>;
export type Item = TrackItem | NodeItem;
export type Link = z.infer<typeof LinkSchema>;
export type EndStep = z.infer<typeof EndStepSchema>;
export type Step = z.infer<typeof StepSchema>;
export type ChainFile = z.infer<typeof ChainFileSchema>;

export const isEndStep = (s: unknown): s is EndStep =>
  !!s && typeof s === "object" && !Array.isArray(s) && "to" in s;

/** A LANE item is `{ id, track, bypass? }` exactly — an input node's own `track:` field is not one. */
export const isTrackItem = (i: unknown): i is TrackItem =>
  !!i &&
  typeof i === "object" &&
  typeof (i as { track?: unknown }).track === "string" &&
  Object.keys(i).every((k) => k === "id" || k === "track" || k === "bypass");

/** The items of a step — none for an end step, one for a single item, several for a parallel one. */
export function itemsOf(s: Step): Item[] {
  if (isEndStep(s)) return [];
  return Array.isArray(s) ? s : [s as Item];
}
