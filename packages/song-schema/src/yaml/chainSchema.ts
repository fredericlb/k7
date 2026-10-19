// chainSchema.ts — a `chains/<name>.k7x` file's shape. A chain is a list of STEPS: a node, a lane,
// several nodes side by side, and last the chains its signal goes on to. Nodes are unnamed and carry
// an `id`; a node item's own fields are a module's and are vetted by parseModule. A chain may hold
// SUBCHAINS, steps under an id that only the parent and its other subchains link to. See docs/chainFiles.md.

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
export const LAYOUT_FILE = "layout.k7x";

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

/** A lane in the chain: its events live in `tracks/<track>.k7x`, and its bypass is its mute. */
const TrackItemSchema = z
  .object({ id: Id, track: z.string().min(1), bypass: z.boolean().optional() })
  .strict();

/** A PICTURE lane: its placements live in `video_tracks/<video_track>.k7x`, and it holds no module. */
const VideoTrackItemSchema = z
  .object({
    id: Id,
    video_track: z.string().min(1),
    bypass: z.boolean().optional(),
  })
  .strict();

/** A node: a module's fields, plus the four a use adds — the rest is checked by parseModule. */
const NodeItemSchema = z
  .object({
    id: Id,
    bypass: z.boolean().optional(),
    vstpreset: z.string().min(1).optional(),
    mapping: z.string().min(1).optional(),
  })
  .passthrough();

const ItemSchema = z.union([
  TrackItemSchema,
  VideoTrackItemSchema,
  NodeItemSchema,
]);

/** Where the signal goes once the chain ends: another chain (a port of it) or a built-in end. */
export const LinkSchema = z
  .object({
    chain: z.string().min(1),
    level: z.number().nonnegative().optional(),
    port: z.string().min(1).optional(),
  })
  .strict();

/** The LAST step: links only, never mixed with nodes. Several links each carry a level. */
const EndStepSchema = z
  .object({ to: z.array(LinkSchema).min(1) })
  .strict()
  .refine((s) => s.to.length < 2 || s.to.every((l) => l.level !== undefined), {
    message: "a step linking several chains gives each link a `level`",
  });

/** A step that RUNS one of the file's subchains in series, right there, its output returning to the next step. */
const CallStepSchema = z.object({ sub: Id }).strict();

const StepSchema = z.union([
  EndStepSchema,
  CallStepSchema,
  z.array(ItemSchema).min(2),
  ItemSchema,
]);

/** A chain inside a chain: steps like any chain, linked into only by its parent and its siblings, docs/chainFiles.md. */
export const SubchainSchema = z
  .object({ id: Id, steps: z.array(StepSchema).default([]) })
  .strict();

type Issue = { path: (string | number)[]; message: string };

/** The rules every list of steps follows, a chain's or a subchain's: one node first, links last. */
function stepIssues(steps: Step[]): Issue[] {
  const out: Issue[] = [];
  if (Array.isArray(steps[0]))
    out.push({
      path: [0],
      message:
        "the first step is one node — its ports are what the chain is linked into",
    });
  steps.forEach((s, i) => {
    if (isEndStep(s) && i !== steps.length - 1)
      out.push({
        path: [i],
        message: "a step of links ends the chain — it can only be the last",
      });
  });
  return out;
}

const SINK_NAMES = new Set<string>(CHAIN_SINKS);

export const ChainFileSchema = z
  .object({
    // `true`: the chain starts at its own first node (a source); `MIX`/`RENDER`: at that sum. Absent: fed by links.
    start: z.union([z.literal(true), z.enum(CHAIN_STARTS)]).optional(),
    // A chain WITHOUT a start names the ports it is linked into; each feeds its first node's input of that name.
    ports: z.array(z.string().min(1)).optional(),
    // Heard only through what it links to, its dry path to the sum removed — docs/busOnly.md.
    bus_only: z.boolean().optional(),
    // Set aside: compiled, drawn and played by nothing, and left as it is by every writer — docs/chainFiles.md.
    hidden: z.boolean().optional(),
    steps: z.array(StepSchema).default([]),
    subchains: z.array(SubchainSchema).optional(),
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
    for (const i of stepIssues(c.steps))
      ctx.addIssue({ code: "custom", ...i, path: ["steps", ...i.path] });
    if (c.start !== true && c.steps.some((s) => itemsOf(s).some(isLaneItem)))
      ctx.addIssue({
        code: "custom",
        path: ["steps"],
        message:
          "a lane is a source: only a chain with `start: true` holds one",
      });
    const subs = c.subchains ?? [];
    const ids = new Set(subs.map((sc) => sc.id));
    // A subchain run in place is a stretch of its parent: called once, from the parent's own steps.
    const called = new Set<string>();
    c.steps.forEach((s, i) => {
      if (!isCallStep(s)) return;
      const issue = (message: string) =>
        ctx.addIssue({ code: "custom", path: ["steps", i, "sub"], message });
      if (i === 0) issue("the first step is one node, not a subchain run");
      if (!ids.has(s.sub)) issue(`this chain has no subchain "${s.sub}"`);
      if (called.has(s.sub)) issue(`subchain "${s.sub}" is run twice`);
      called.add(s.sub);
    });
    const linked = new Set(
      [c.steps, ...subs.map((sc) => sc.steps)].flatMap((steps) => {
        const end = steps[steps.length - 1];
        return isEndStep(end) ? end.to.map((l) => l.chain) : [];
      }),
    );
    const seen = new Set<string>();
    subs.forEach((sc, j) => {
      const at = ["subchains", j];
      const issue = (path: (string | number)[], message: string) =>
        ctx.addIssue({ code: "custom", path: [...at, ...path], message });
      if (seen.has(sc.id)) issue(["id"], `two subchains are called "${sc.id}"`);
      seen.add(sc.id);
      if (SINK_NAMES.has(sc.id))
        issue(["id"], `"${sc.id}" is a built-in end, not a subchain's name`);
      for (const i of stepIssues(sc.steps))
        issue(["steps", ...i.path], i.message);
      if (sc.steps.some((s) => itemsOf(s).some(isLaneItem)))
        issue(["steps"], "a lane is a source: a subchain cannot hold one");
      sc.steps.forEach((s, i) => {
        if (isCallStep(s))
          issue(
            ["steps", i],
            "a subchain runs no subchain: they are one level deep",
          );
      });
      if (called.has(sc.id)) {
        if (!sc.steps.some((s) => itemsOf(s).length))
          issue(["steps"], "a subchain run in place holds at least one node");
        if (isEndStep(sc.steps[sc.steps.length - 1]))
          issue(
            ["steps"],
            "a subchain run in place returns to its parent: it ends with no `to:`",
          );
        if (linked.has(sc.id))
          issue(
            ["id"],
            `subchain "${sc.id}" is run in place, so nothing links to it`,
          );
      }
      // Closed both ways: out of a subchain, the signal reaches a sibling or a built-in end, nothing else.
      const end = sc.steps[sc.steps.length - 1];
      if (isEndStep(end))
        end.to.forEach((l, k) => {
          if (!ids.has(l.chain) && !SINK_NAMES.has(l.chain))
            issue(
              ["steps", sc.steps.length - 1, "to", k, "chain"],
              `a subchain links only to its parent's subchains or a built-in end, not "${l.chain}"`,
            );
        });
    });
  });

export type TrackItem = z.infer<typeof TrackItemSchema>;
export type VideoTrackItem = z.infer<typeof VideoTrackItemSchema>;
export type NodeItem = z.infer<typeof NodeItemSchema>;
export type Item = TrackItem | VideoTrackItem | NodeItem;
export type Link = z.infer<typeof LinkSchema>;
export type EndStep = z.infer<typeof EndStepSchema>;
export type Step = z.infer<typeof StepSchema>;
export type CallStep = z.infer<typeof CallStepSchema>;
export type ChainFile = z.infer<typeof ChainFileSchema>;
export type Subchain = z.infer<typeof SubchainSchema>;

export const isEndStep = (s: unknown): s is EndStep =>
  !!s && typeof s === "object" && !Array.isArray(s) && "to" in s;

/** A step running a subchain in place — `{ sub }`, holding no item of its own. */
export const isCallStep = (s: unknown): s is CallStep =>
  !!s &&
  typeof s === "object" &&
  !Array.isArray(s) &&
  "sub" in s &&
  !("id" in s);

/** A LANE item is `{ id, track, bypass? }` exactly — an input node's own `track:` field is not one. */
export const isTrackItem = (i: unknown): i is TrackItem =>
  !!i &&
  typeof i === "object" &&
  typeof (i as { track?: unknown }).track === "string" &&
  Object.keys(i).every((k) => k === "id" || k === "track" || k === "bypass");

/** …and a PICTURE lane item, `{ id, video_track, bypass? }` exactly, by the same rule. */
export const isVideoTrackItem = (i: unknown): i is VideoTrackItem =>
  !!i &&
  typeof i === "object" &&
  typeof (i as { video_track?: unknown }).video_track === "string" &&
  Object.keys(i).every(
    (k) => k === "id" || k === "video_track" || k === "bypass",
  );

/** Either kind of LANE — a source, named by its lane rather than its id. */
export const isLaneItem = (i: unknown): i is TrackItem | VideoTrackItem =>
  isTrackItem(i) || isVideoTrackItem(i);

/** The lane an item IS, of either kind, or undefined for a node. */
export const laneOfItem = (i: unknown): string | undefined =>
  isTrackItem(i) ? i.track : isVideoTrackItem(i) ? i.video_track : undefined;

/** The items of a step — none for an end step, one for a single item, several for a parallel one. */
export function itemsOf(s: Step): Item[] {
  if (isEndStep(s) || isCallStep(s)) return [];
  return Array.isArray(s) ? s : [s as Item];
}

/** Every list of steps a chain file holds — its own, then each subchain's under its id. */
export function stepLists(c: ChainFile): { sub?: string; steps: Step[] }[] {
  return [
    { steps: c.steps },
    ...(c.subchains ?? []).map((sc) => ({ sub: sc.id, steps: sc.steps })),
  ];
}

/** The ids of the subchains a chain RUNS in place, by its `{ sub }` steps. */
export const calledSubchains = (c: ChainFile): Set<string> =>
  new Set(c.steps.filter(isCallStep).map((s) => s.sub));

/** A chain's own steps with each `{ sub }` replaced by that subchain's steps — the run as it plays. */
export function expandCalls(c: ChainFile): Step[] {
  const byId = new Map((c.subchains ?? []).map((sc) => [sc.id, sc.steps]));
  return c.steps.flatMap((s) =>
    isCallStep(s) ? (byId.get(s.sub) ?? []).filter((x) => !isEndStep(x)) : [s],
  );
}
