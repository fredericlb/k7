// contextMenu.ts — the right-click entries for a timeline/graph entity. Every entry IS a command
// line: one the click already filled runs, one still owing an argument goes to the bar. The list
// is DERIVED from the command catalogue — whatever was clicked says which type it can answer for.
// A row is drawn as the command's NAME minus the word naming what was clicked; what it does is a
// sentence for the status bar. See docs/contextMenu.md.

import { type CommandPrefs, inMenu } from "./commandPrefs";
import type { ArgClass, ArgProvider, CommandInfo, MenuEntity } from "./types";

// What the cursor was over. `id` is the entity as commands name it: a track/module id, a clip's ref, a chain name.
export type MenuCtx =
  // `picked`: the lanes shift-clicked together with this one, when it is among them — what `track group` is offered over.
  | { kind: "track"; id: string; picked?: string[] }
  | { kind: "group"; id: string }
  // A 'block' in the graph: `missing` is no file, no plugin and no param; `ambient` is the ENGINE's, and can be given a folder.
  // `model`: it names a model this machine has not got, and its module's `model_url` says where to fetch it.
  // `native`: an external plugin (VST, AU…) with its own window — the only node `node external-ui` is offered on.
  | {
      kind: "module";
      id: string;
      missing?: boolean;
      ambient?: boolean;
      model?: boolean;
      native?: boolean;
    }
  // A placed clip — `track` + `tc` say WHICH placement, and `sel` is the RECTANGLE the click landed in, which the range verbs need.
  | {
      kind: "clip";
      id: string;
      track?: string;
      tc?: string;
      sel?: { tracks: string; from: string; to: string } | null;
    }
  // One control on a module: `param` is the widget's `bind`, `cc` what is mapped to it — its own kind, a binding being per param.
  | {
      kind: "param";
      id: string;
      param: string;
      label: string;
      cc?: { ch: number; cc: number };
      /** A curve drives it today: the menu offers to stop that. */
      automated?: boolean;
    }
  // Right-click on an AUTOMATION row: the curve the verbs address, and the moment a point would go at.
  | { kind: "curve-point"; curve: string; param: string; tc: string }
  // A CURVE CARD right-clicked: the curve, and the param it drives when the card is a binding rather than a free curve.
  | { kind: "curve-card"; curve: string; module?: string; param?: string }
  // A pass-through node — a chain with no modules; nothing is offered on it now, so the id is all it needs to say.
  | { kind: "chain"; id: string }
  | { kind: "sink"; id: string }
  // A BOX — an assembly instance, plus the template ref, so a row may address either (packages/song/docs/assemblies.md).
  | { kind: "assembly"; id: string; uses: string }
  // Right-click on the timeline ruler — offer to drop a marker at `tc`, the beat under the pointer snapped to the drawn grid.
  // `loop`: what `transport loop` would do right now — loop the selection, clear the loop, or nothing to offer.
  | { kind: "marker-add"; tc: string; loop?: "set" | "clear" }
  // Right-click on an existing marker — offer to delete it by name.
  | { kind: "marker"; name: string }
  /** Right-click on a STRETCH POINT in the warp view: `src` is the FILE second it pins, already spelled, the rounding being the caller's. */
  | { kind: "warp-point"; clip: string; src: string }
  /** A SHOT on a picture lane: the lane, and where it starts in SECONDS — the dialect the `picture …` verbs read. */
  | { kind: "picture-shot"; lane: string; at: string; name: string }
  /** A PAD in the step sequencer — sequence, key and start beat, plus what it ALREADY carries, so a row is offered only when it does something. */
  | {
      kind: "pad";
      sequence: string;
      note: number;
      start: number;
      repeat?: number;
      skip?: number;
    }
  /** A rack's PAD on a node's card: the node whose kit it is, and the sound — what every `node tap …` verb takes. */
  | { kind: "tap"; id: string; symbol: string }
  /** A NOTE on the roll: key and start as every `sequence note …` verb takes them, `at` the caret a split would cut at, `region` the rectangle the four plural verbs need — a clip's `sel` again. */
  | {
      kind: "note";
      sequence: string;
      note: number;
      start: number;
      end: number;
      at?: number;
      region?: { lo: number; hi: number; from: number; to: number };
    };

/** The values a pad's effects are offered at — a closed set, so the menu is a choice; the schema still takes any whole number from 2 up. */
const PAD_EFFECT_VALUES = [2, 4] as const;

// A canonical entry: `verb` the command, `arg` its entity, `needsMore` a trailing space when a value is owed; `help` and `name` override the catalogue.
interface Entry {
  verb: string;
  arg?: string;
  needsMore?: boolean;
  help?: string;
  name?: string;
}

/** A displayable menu item: what the command is CALLED, what it does, and the line it stands for — `complete` says the host RUNS it. */
export interface MenuItem {
  /** The command's NAME, minus the word that names the thing you clicked — see `shortName`. */
  label: string;
  /** What it DOES, as one sentence in the language being read — put in the STATUS BAR rather than drawn in the row. */
  description: string;
  command: string;
  complete: boolean;
  /** Ask before running it: the catalogue's `confirm:`, for the few that destroy more than Ctrl+Z is trusted with. */
  confirm?: boolean;
  /** The VERB this entry stands for, without the entity it was built for and untranslated — exactly what `commandPrefs` is keyed by. */
  verb: string;
}

/** One argument the clicked thing can answer, in the order the command asks: `provider` is the precise type, `kind` is for the scalars. */
interface Slot {
  provider?: ArgProvider;
  kind?: ArgClass;
  // The argument's own name, when even the provider cannot tell two commands apart — `node param` and `module clone` are one shape.
  name?: string;
  value: string;
}

// An argument that must survive as ONE token: the dispatcher splits on whitespace, so anything with a space is quoted and nothing else is.
const quoteArg = (s: string): string => (/\s/.test(s) ? JSON.stringify(s) : s);

/** Every catalogue command whose LEADING arguments are exactly what this thing can answer — which is the whole mechanism (docs/contextMenu.md). */
function fromCatalogue(commands: CommandInfo[], slots: Slot[]): Entry[] {
  return commands.flatMap((c) => {
    if (c.args.length < slots.length) return [];
    for (const [i, s] of slots.entries()) {
      const a = c.args[i];
      if (s.provider ? a.provider !== s.provider : a.kind !== s.kind) return [];
      if (s.name && a.name !== s.name) return [];
    }
    return [
      {
        verb: c.command,
        arg: slots.map((s) => quoteArg(s.value)).join(" "),
        // Anything left is still to type: the trailing space is where the caret lands, and what tells the bar to complete an ARGUMENT.
        needsMore: c.args.length > slots.length,
      },
    ];
  });
}

/** The catalogue's help line, as the sentence a row reports to the status bar — the `(e.g. …)` tail dropped, every other parenthetical kept. */
const readable = (help: string): string =>
  help.replace(/\s*\(e\.g\.[^)]*\)/g, "").trim();

/** The word that names the thing you right-clicked, dropped off the front of every row that starts with it — one word per context (docs/contextMenu.md). */
const CLICKED_HEAD: Record<MenuCtx["kind"], string> = {
  track: "track",
  group: "track",
  // What you clicked is the NODE — the use of a module; `module clone` and `module cc` keep their head, following it everywhere.
  module: "node",
  clip: "event",
  // Nothing: a param's three verbs name three different subjects, and none of them is the control you clicked.
  param: "",
  // 'curve': the row IS the curve, so its three read 'point add', 'point move', 'point remove'.
  "curve-point": "curve",
  // Every row is named by hand, so there is nothing to drop.
  "curve-card": "",
  chain: "",
  sink: "",
  // What you clicked is the box, and every row about one already begins with the word.
  assembly: "assembly",
  "marker-add": "project",
  marker: "project",
  // 'clip': the row reads 'warp remove', which is what the point under the pointer is about.
  "warp-point": "clip",
  // 'picture': the rows read 'move', 'length', 'head', 'delete' — the shot is what was clicked.
  "picture-shot": "picture",
  // 'sequence note': a pad's rows are named for the value they set, and the head is what every one of them shares.
  pad: "sequence note",
  // The same head, for the same reason: on the roll the rows read 'remove' and 'split'.
  note: "sequence note",
  // Every row is named by hand, so there is nothing to drop.
  tap: "",
};

/** Which ENTITY each context IS, as `commands.yaml`'s `menu:` names it — `chain` and `sink` open none. */
const CTX_ENTITY: Record<MenuCtx["kind"], MenuEntity | undefined> = {
  track: "track",
  group: "group",
  // A block is the NODE, the same word `CLICKED_HEAD` drops off its rows.
  module: "node",
  clip: "event",
  param: "param",
  "curve-point": "curve",
  // A bound card stands for the PARAM it drives: its rows are the param's own (`node automate` is offered there).
  "curve-card": "param",
  chain: undefined,
  sink: undefined,
  assembly: "assembly",
  "marker-add": "ruler",
  marker: "marker",
  "warp-point": "warp",
  "picture-shot": "shot",
  pad: "pad",
  note: "note",
  tap: "tap",
};

const shortName = (name: string, head: string): string =>
  head && name.startsWith(`${head} `) ? name.slice(head.length + 1) : name;

// The ONE place every entry passes through, so 'not on the right-click' is applied once and cannot be forgotten by a new `case` below.
const build = (
  commands: CommandInfo[],
  entries: Entry[],
  prefs: CommandPrefs = {},
  /** The head to drop off the names — `CLICKED_HEAD` for this context. "" drops nothing. */
  head = "",
  /** Which language the DESCRIPTION is read in. The names stay the CLI's, which are English. */
  locale = "en",
  /** What was clicked, for the catalogue's `menu:` — undefined asks nothing of it. */
  entity?: MenuEntity,
): MenuItem[] => {
  const kept = entries.filter((e) =>
    inMenu(
      e.verb,
      prefs,
      entity,
      commands.find((c) => c.command === e.verb)?.menu,
    ),
  );
  const full = kept.map((e) => e.name ?? e.verb);
  const short = full.map((n, i) => (kept[i].name ? n : shortName(n, head)));
  // All or nothing: the list is DERIVED, so when shortening would make a pair indistinguishable nothing is dropped.
  const distinct = new Set(short).size === short.length;
  return kept.map((e, i) => {
    const line = e.arg ? `${e.verb} ${e.arg}` : e.verb;
    const c = commands.find((cmd) => cmd.command === e.verb);
    return {
      // What it is CALLED; what it does is `description`, which the status bar draws on hover — a menu of sentences is read, not scanned.
      label: distinct ? short[i] : full[i],
      // The entry's OWN line wins outright: `module cc … none` is the unbind, which the catalogue's sentence contradicts.
      description: e.help
        ? readable(e.help)
        : (c?.readable as Record<string, string> | undefined)?.[locale] ||
          readable(c?.help ?? ""),
      command: line.trim() + (e.needsMore ? " " : ""),
      complete: !e.needsMore,
      // Only when it asks: a row that does not carries no word saying so.
      ...(c?.confirm ? { confirm: true } : {}),
      verb: e.verb,
    };
  });
};

// The verbs that still mean something on a node NOTHING answers to — each acts on graph.k7x alone, which the catalogue cannot say.
const SURVIVES_MISSING = new Set(["node bypass", "graph unlink"]);

// The lane gutter's menu lives in nodeMenu.ts; re-exported for the shell, which imports it from here.
export { type NodeMenuTarget, nodeMenu } from "./nodeMenu";

/** A module the ENGINE provides has no file anywhere, and the `@engine/` prefix is exactly what says so — derived at the point of use. */
export const withAmbient = (ctx: MenuCtx): MenuCtx =>
  ctx.kind === "module" && ctx.id.startsWith("@engine/")
    ? { ...ctx, ambient: true }
    : ctx;

/** The menu for a context; empty means "don't open a menu here". */
export function contextMenu(
  ctx: MenuCtx,
  commands: CommandInfo[],
  /** The person's own arrangement — only `menu: false` is read here. Absent ⇒ nothing hidden. */
  prefs: CommandPrefs = {},
  /** The language the descriptions are read in. Names are the CLI's and never translated. */
  locale = "en",
): MenuItem[] {
  const from = (slots: Slot[]): Entry[] => fromCatalogue(commands, slots);
  // Bound once, so no `case` below can forget the prefs or the head — which would ignore what someone turned off, in one context out of nine.
  const offer = (entries: Entry[]): MenuItem[] =>
    build(
      commands,
      entries,
      prefs,
      CLICKED_HEAD[ctx.kind],
      locale,
      CTX_ENTITY[ctx.kind],
    );
  switch (ctx.kind) {
    case "tap": {
      // NOT derived: the rows are named for the pad, in the order a kit is edited — docs/contextMenu.md.
      const at = `${quoteArg(ctx.id)} ${quoteArg(ctx.symbol)}`;
      return offer([
        {
          verb: "node tap note",
          arg: at,
          needsMore: true,
          name: "Change note…",
        },
        {
          verb: "node tap sample",
          arg: at,
          needsMore: true,
          name: "Change sample…",
        },
        { verb: "node tap rename", arg: at, needsMore: true, name: "Rename…" },
        { verb: "node tap remove", arg: at, name: "Remove" },
        {
          verb: "node tap insert",
          arg: `${quoteArg(ctx.id)} before ${quoteArg(ctx.symbol)}`,
          name: "Add one before",
        },
        {
          verb: "node tap insert",
          arg: `${quoteArg(ctx.id)} after ${quoteArg(ctx.symbol)}`,
          name: "Add one after",
        },
        // …and its OWN chain of effects, in a popin: a rack's tap or a kit's pad alike (song docs/racks.md).
        {
          verb: "ui tap chain",
          arg: at,
          name: "Edit chain…",
          help: "this tap's own chain of effects — add, remove, reorder",
        },
      ]);
    }
    case "track": {
      const several = ctx.picked && ctx.picked.length > 1 ? ctx.picked : null;
      return offer([
        // Several lanes picked: grouping them comes first, and the clicked lane's own one-track group is not offered beside it.
        ...(several
          ? [
              {
                verb: "track group",
                arg: quoteArg(several.join(",")),
                name: `Group the ${several.length} tracks`,
              },
            ]
          : []),
        ...from([{ provider: "tracks", value: ctx.id }]).filter(
          (e) => !several || e.verb !== "track group",
        ),
        // The shell's own, and last: everything above acts on the track, this one opens the file that spells it.
        {
          verb: "ui file",
          arg: ctx.id,
          help: "open the track's own file, tracks/<id>.k7x",
        },
      ]);
    }
    case "group":
      // NOT derived, deliberately: a group answers `track mute` and `track solo` but is not a value the `tracks` provider lists.
      return offer([
        { verb: "track mute", arg: ctx.id },
        { verb: "track solo", arg: ctx.id },
      ]);
    case "module": {
      /** A block in the graph is BOTH a node and the module behind it, so the menu offers both families — the use first. */
      const own = [
        ...from([{ provider: "nodes", value: ctx.id }]),
        ...from([{ provider: "modules", value: ctx.id }]),
      ].filter((e) => ctx.native || e.verb !== "node external-ui");
      if (ctx.missing)
        return offer(own.filter((e) => SURVIVES_MISSING.has(e.verb)));
      return offer([
        // FIRST when it applies: nothing else on this node can work until the model is here.
        ...(ctx.model
          ? [
              {
                verb: "ui model",
                arg: ctx.id,
                name: "Download model",
                help: "download the model this module needs onto this machine, from its model_url",
              },
            ]
          : []),
        ...own,
        // A module the engine merely reports IS an engine ref, which `module own` takes; with no file anywhere, it replaces `ui file`.
        ...(ctx.ambient
          ? from([{ provider: "engineModules", value: ctx.id }])
          : [
              {
                verb: "ui file",
                arg: ctx.id,
                help: "open the module's own file in the editor",
              },
            ]),
      ]);
    }
    case "clip": {
      // Every verb the rectangle can answer whole, and their names — so the derivation below does not offer the same verb one argument short.
      const range = ctx.sel
        ? from([
            { provider: "tracks", value: ctx.sel.tracks },
            { kind: "timecode", value: ctx.sel.from },
            { kind: "timecode", value: ctx.sel.to },
          ])
        : [];
      const ranged = new Set(range.map((e) => e.verb));
      // Deliberately NOT the `clip …` family: what was right-clicked is an EVENT, and the material it references may sit on other lanes too.
      return offer([
        {
          verb: "ui file",
          arg: ctx.id,
          help: "open the clip's own definition in the editor",
        },
        // The RANGE verbs first, from the rectangle: three slots rather than two, so a command that takes a span arrives with its span.
        ...range,
        // The `event …` family addresses a PLACEMENT, offered only when the caller said where this one sits.
        ...(ctx.track && ctx.tc
          ? from([
              { provider: "tracks", value: ctx.track },
              { kind: "timecode", value: ctx.tc },
            ]).filter((e) => !ranged.has(e.verb))
          : []),
      ]);
    }
    case "param": {
      // Two shapes, one control: `node param` names a USE and `module cc` the module the map follows — the quoting is `fromCatalogue`'s.
      const target: Slot[] = [
        { provider: "nodes", value: ctx.id },
        { kind: "text", name: "param", value: ctx.param },
      ];
      const onModule: Slot[] = [
        { provider: "modules", value: ctx.id },
        { kind: "text", name: "param", value: ctx.param },
      ];
      const quoted = `${ctx.id} ${quoteArg(ctx.param)}`;
      return offer([
        // Learn is a UI command, not a brain one: it arms the browser's Web MIDI, and still goes through the bar like everything else.
        {
          verb: "ui midi learn",
          arg: quoted,
          help: "bind this param to the next controller knob you touch",
        },
        // …and the curve editor on it: the curve this param is bound to, or a new one bound on Save (docs/curveEditor.md).
        {
          verb: "ui automate",
          arg: quoted,
          help: "automate this param with a curve — the one it follows, or a new one",
        },
        // …and the unbind, only when a curve drives it: `none` is a literal the entry writes, so it is named — the curve stays.
        ...(ctx.automated
          ? [
              {
                verb: "node automate",
                // Unquoted: the verb takes the words between the node and the curve as the param, and keeps quotes literal.
                arg: `${ctx.id} ${ctx.param} none`,
                name: "remove automation",
                help: "stop this param following its curve — the curve itself stays",
              },
            ]
          : []),
        ...from(target),
        ...from(onModule),
        // The unbind, only worth offering when there is one to remove — `module cc` with a value no argument shape can express.
        ...(ctx.cc
          ? [
              {
                verb: "module cc",
                arg: `${quoted} none`,
                // Named, because the bind is on this same menu under the same verb: `none` is a literal the entry writes.
                name: "module cc none",
                help: "remove the MIDI binding on this param",
              },
            ]
          : []),
      ]);
    }
    case "curve-point":
      /** An automation row's three verbs, written out for the reason a take's two are — `add` is left needing its value. */
      return offer([
        {
          verb: "curve point add",
          arg: `${ctx.curve} ${ctx.tc}`,
          needsMore: true,
        },
        {
          verb: "curve point move",
          arg: `${ctx.curve} ${ctx.tc}`,
          needsMore: true,
        },
        { verb: "curve point remove", arg: `${ctx.curve} ${ctx.tc}` },
      ]);
    case "curve-card": {
      // A free card has no param to automate: its one row opens the curve itself.
      if (!ctx.module || !ctx.param)
        return offer([
          { verb: "ui curve", arg: ctx.curve, help: "edit this curve" },
        ]);
      const quoted = `${ctx.module} ${quoteArg(ctx.param)}`;
      return offer([
        // The same editor the param's own menu opens, on the curve this card is (docs/curveEditor.md).
        {
          verb: "ui automate",
          arg: quoted,
          help: "edit this curve, as the automation of its param",
        },
        {
          verb: "node automate",
          // Unquoted: the verb takes the words between the node and the curve as the param, and keeps quotes literal.
          arg: `${ctx.module} ${ctx.param} none`,
          name: "remove automation",
          help: "stop this param following this curve — the curve itself stays",
        },
      ]);
    }
    case "chain":
      /** A chain answers no command's FIRST argument, and its one reader verb is gone — so this opens no menu, like `sink`. */
      return [];
    case "sink":
      return []; // OUT — nothing per-entity to do
    case "assembly":
      // Derived like every other family: the verbs whose first argument is an assembly, plus the
      // one door out of the box — its TEMPLATE, which is where its plugs and its knobs are decided.
      return offer([
        ...from([{ provider: "assemblies", value: ctx.id }]),
        {
          verb: "ui assembly",
          arg: ctx.uses,
          help: "open the template this box is one of, in the builder",
        },
      ]);
    case "marker-add":
      // A bare timecode: `project marker new <tc> `, leaving the TEXT cursor where the name is typed.
      return offer([
        ...from([{ kind: "timecode", value: ctx.tc }]),
        // The shell's own: it acts on the selection the ruler swept, which no argument of the line carries.
        ...(ctx.loop
          ? [
              {
                verb: "transport loop",
                name: ctx.loop === "set" ? "Loop selection" : "Clear loop",
                help:
                  ctx.loop === "set"
                    ? "make the selected range the transport loop"
                    : "stop looping",
              },
            ]
          : []),
      ]);
    case "marker":
      // Through `offer` like every other case: going straight to `build` skipped the prefs, in one menu out of nine.
      return offer(from([{ provider: "markerNames", value: ctx.name }]));
    case "warp-point":
      /** Written out rather than derived, for the reason a take's two verbs are; `clip warp` is deliberately not beside it — placing is the gesture. */
      return offer([
        { verb: "clip warp remove", arg: `${ctx.clip} ${ctx.src}` },
      ]);
    case "picture-shot": {
      /** The lane and the start address the shot; the three that need a destination go to the bar with it typed. */
      const where = `${ctx.lane} ${ctx.at}`;
      return offer([
        { verb: "picture move", arg: `${where} `, needsMore: true },
        { verb: "picture head", arg: `${where} `, needsMore: true },
        { verb: "picture length", arg: `${where} `, needsMore: true },
        { verb: "picture silence", arg: where },
        { verb: "picture delete", arg: where },
      ]);
    }
    case "pad": {
      /** A pad's effects, written out for the reason a take's two verbs are — one row per VALUE, each named, since two rows share a verb. */
      const where = `${ctx.sequence} ${ctx.note} ${ctx.start}`;
      const rows: Entry[] = [];
      for (const n of PAD_EFFECT_VALUES)
        if (ctx.repeat !== n)
          rows.push({
            verb: "sequence note repeat",
            arg: `${where} ${n}`,
            name: `repeat ×${n}`,
          });
      if (ctx.repeat)
        rows.push({
          verb: "sequence note repeat",
          arg: `${where} off`,
          name: "repeat off",
        });
      for (const n of PAD_EFFECT_VALUES)
        if (ctx.skip !== n)
          rows.push({
            verb: "sequence note skip",
            arg: `${where} ${n}`,
            name: `skip 1/${n}`,
          });
      if (ctx.skip)
        rows.push({
          verb: "sequence note skip",
          arg: `${where} off`,
          name: "skip off",
        });
      return offer(rows);
    }
    case "note": {
      /** The roll's own two, both already addressed by the click — nothing here owes an argument to the bar. */
      const where = `${ctx.sequence} ${ctx.note} ${ctx.start}`;
      const rows: Entry[] = [{ verb: "sequence note remove", arg: where }];
      // Split is offered only where there is something to split: a cut on either edge would leave a note of length zero.
      if (
        ctx.at !== undefined &&
        ctx.at > ctx.start + 1e-6 &&
        ctx.at < ctx.end - 1e-6
      )
        rows.push({ verb: "sequence note split", arg: `${where} ${ctx.at}` });
      // …then the RECTANGLE's four, when the click landed in one. The three that owe a value go to the bar with the box already spelt.
      const r = ctx.region;
      if (r) {
        const box = `${ctx.sequence} ${r.lo} ${r.hi} ${r.from} ${r.to}`;
        rows.push(
          { verb: "sequence notes remove", arg: box },
          { verb: "sequence notes transpose", arg: box, needsMore: true },
          { verb: "sequence notes quantize", arg: box, needsMore: true },
          { verb: "sequence notes velocity", arg: box, needsMore: true },
        );
      }
      return offer(rows);
    }
  }
}
