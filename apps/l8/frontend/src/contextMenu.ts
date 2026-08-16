// contextMenu.ts — the right-click entries for a timeline/graph entity. Every entry IS a command
// line: one the click already filled runs, one still owing an argument goes to the bar. The list
// is DERIVED from the command catalogue — whatever was clicked says which type it can answer
// for, and every command whose leading arguments are exactly that is offered. See
// docs/contextMenu.md.

import { localizeCommand, localizeCommandLine } from "./commandI18n";
import { type CommandPrefs, inMenu } from "./commandPrefs";
import type { ArgClass, ArgProvider, CommandInfo } from "./types";

// What the cursor was over. `id` is the entity as commands name it: a track/module id, a clip's ref, a chain name.
export type MenuCtx =
  | { kind: "track"; id: string }
  | { kind: "group"; id: string }
  // A "block" in the graph. `missing` means no file, no plugin and no param — the menu shrinks to what still
  // applies. `ambient` means the ENGINE provides it and nothing is on disk: it can be given a folder.
  | { kind: "module"; id: string; missing?: boolean; ambient?: boolean }
  // A placed clip. `track` + `tc` say WHICH placement, so the `event …` family can be offered; both optional.
  | { kind: "clip"; id: string; track?: string; tc?: string }
  // One control on a module, right-clicked: `param` is the widget's `bind`, `cc` what is already
  // mapped to it. A binding is per param, so this is its own kind rather than part of "module".
  | {
      kind: "param";
      id: string;
      param: string;
      label: string;
      cc?: { ch: number; cc: number };
    }
  // A TAKE row under a lane: the track it belongs to, and which take it is (1-based).
  | { kind: "take"; track: string; n: number }
  // A pass-through node — a chain with no modules. It carried the track it belonged to, for the
  // one reader that took one; nothing is offered on it now, so the id is all it needs to say.
  | { kind: "chain"; id: string }
  | { kind: "sink"; id: string }
  // Right-click on the timeline ruler — offer to drop a marker at `tc`, the beat under the
  // pointer snapped to the ruler's drawn grid (the timeline resolves it).
  | { kind: "marker-add"; tc: string }
  // Right-click on an existing marker — offer to delete it by name.
  | { kind: "marker"; name: string };

// A canonical entry: `verb` the command, `arg` its entity, `needsMore` a trailing space when a value is still owed.
// `help` overrides the catalogue's line — only the shell's OWN commands need it, having none there.
interface Entry {
  verb: string;
  arg?: string;
  needsMore?: boolean;
  help?: string;
}

/**
 * A displayable menu item: what the command DOES, and the localized line it stands for.
 *
 * `complete` says every argument is already filled from what was clicked — so there is nothing
 * for the bar to collect, and the host RUNS the line instead of pre-writing it. Read it here
 * rather than sniffing the trailing space off `command`: the space is a caret position, and
 * two different questions must not share one accident of formatting.
 */
export interface MenuItem {
  label: string;
  command: string;
  complete: boolean;
  /**
   * The VERB this entry stands for — `node bypass`, `event remove` — without the entity it was
   * built for, and untranslated.
   *
   * That string is exactly what `commandPrefs` is keyed by, so it is what lets the renderer draw
   * the icon and the name this person chose. Kept apart from `command`, which carries the entity
   * and is localized: two menu entries for the same verb on two different tracks are the same
   * command wearing the same icon.
   */
  verb: string;
}

/**
 * One argument the clicked thing can answer, in the order the command asks them.
 *
 * `provider` is the precise type — a `tracks` value, a `modules` one. The argument's CLASS is
 * only its colour and is too coarse to match on: `file` is a clip and a sequence and a module
 * asset, `module` is also a category. `kind` is for the scalars, which have no provider.
 */
interface Slot {
  provider?: ArgProvider;
  kind?: ArgClass;
  // The argument's own name, when even the provider cannot tell two commands apart. One case:
  // `node param <node> <param>` and `module clone <module> <newName>` are the SAME shape —
  // a module then free text — and a right-clicked param is one of those and not the other.
  name?: string;
  value: string;
}

// An argument that must survive as ONE token. Plugins name their params "Filter Freq", and the
// dispatcher splits on whitespace — so anything with a space is quoted, and nothing else is.
const quoteArg = (s: string): string => (/\s/.test(s) ? JSON.stringify(s) : s);

/**
 * Every catalogue command whose LEADING arguments are exactly what this thing can answer.
 *
 * This is the whole mechanism: a track offers its sixteen commands without the menu listing one
 * of them, and a command added to commands.yaml appears here the day it is written. Catalogue
 * order is kept, which already reads as grouped by subject.
 */
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
        // Anything left is still to type. The trailing space is where the caret lands, and it is
        // also what tells the bar to complete the next ARGUMENT rather than the command name.
        needsMore: c.args.length > slots.length,
      },
    ];
  });
}

/**
 * The catalogue's help line, as a menu row.
 *
 * The `(e.g. …)` tail is dropped. It answers "how do I type this", which the pre-written line
 * answers better by being the line; every other parenthetical — a value list, an aside — says
 * what the command DOES and is kept.
 */
const readable = (help: string): string =>
  help.replace(/\s*\(e\.g\.[^)]*\)/g, "").trim();

// The ONE place every entry passes through, whichever context built it — so the person's
// "not on the right-click" is applied once and cannot be forgotten by a new `case` below. It
// filters rather than being consulted at each source: the hand-written entries (`ui file` on a
// lane, `track mute` on a group) are not in the catalogue and would otherwise escape it.
const build = (
  commands: CommandInfo[],
  entries: Entry[],
  prefs: CommandPrefs = {},
): MenuItem[] =>
  entries
    .filter((e) => inMenu(e.verb, prefs))
    .map((e) => {
      const line = e.arg ? `${e.verb} ${e.arg}` : e.verb;
      const help =
        e.help ?? commands.find((c) => c.command === e.verb)?.help ?? "";
      return {
        // What it does, not what it is called. The command itself is still shown beside it (see
        // ContextMenu.tsx) — the menu's contract is that it pre-writes a line, and hiding the line
        // would make that opaque.
        label: readable(help) || localizeCommand(e.verb),
        command: localizeCommandLine(line) + (e.needsMore ? " " : ""),
        complete: !e.needsMore,
        verb: e.verb,
      };
    });

// The verbs that still mean something on a node NOTHING answers to. Each acts on graph.yaml
// alone, which is why they survive; the catalogue cannot say this, since it describes arguments
// and this is about what the handler touches.
//
// `node replace` used to be here, as the repair that created the missing module and pointed
// the chains at it. It repoints an `extends:` now — there is no file behind a dangling name to
// repoint — so offering it would be offering a verb that can only answer "no such module".
// What is left for one is to take it out (`graph unlink`) or to write the file it names.
const SURVIVES_MISSING = new Set(["node bypass", "graph unlink"]);

/** The menu for a context; empty means "don't open a menu here". */
export function contextMenu(
  ctx: MenuCtx,
  commands: CommandInfo[],
  /** The person's own arrangement — only `menu: false` is read here. Absent ⇒ nothing hidden. */
  prefs: CommandPrefs = {},
): MenuItem[] {
  const from = (slots: Slot[]): Entry[] => fromCatalogue(commands, slots);
  // Bound once, so no `case` below can forget the prefs — which is the failure this would
  // have: a menu that quietly ignores what someone turned off, in one context out of nine.
  const offer = (entries: Entry[]): MenuItem[] =>
    build(commands, entries, prefs);
  switch (ctx.kind) {
    case "track":
      return offer([
        ...from([{ provider: "tracks", value: ctx.id }]),
        // The shell's own, and last: everything above acts on the track, this one opens the file
        // that spells it. It is not in the catalogue, so it carries its own line.
        {
          verb: "ui file",
          arg: ctx.id,
          help: "open the track's own file, tracks/<id>.yaml",
        },
      ]);
    case "group":
      // NOT derived, and this is the one place that is deliberate: a group answers to `track
      // mute` and `track solo` (their help says "or group's"), but it is not a value the `tracks`
      // provider lists — so asking the catalogue for "commands on this type" would offer a group
      // a freeze, a gain and four `event` verbs, none of which reach it.
      return offer([
        { verb: "track mute", arg: ctx.id },
        { verb: "track solo", arg: ctx.id },
      ]);
    case "module": {
      /**
       * A block in the graph is BOTH, and the menu offers both families.
       *
       * It is a NODE — one use of a module, which is what the chains name and what `node
       * bypass`, `node param`, `node freeze` and the rest address — and it resolves to the
       * MODULE behind it, which `module clone` and `module cc` act on. Two
       * providers, one click, in that order: what you right-clicked is the use.
       */
      const own = [
        ...from([{ provider: "nodes", value: ctx.id }]),
        ...from([{ provider: "modules", value: ctx.id }]),
      ];
      if (ctx.missing)
        return offer(own.filter((e) => SURVIVES_MISSING.has(e.verb)));
      return offer([
        ...own,
        // A module the engine merely reports IS a base-module ref, which is what `module own`
        // takes — so the catalogue answers this one too, rather than the menu knowing it. With
        // no file anywhere, `ui file` would open nothing, so it is offered INSTEAD.
        ...(ctx.ambient
          ? from([{ provider: "baseModules", value: ctx.id }])
          : [
              {
                verb: "ui file",
                arg: ctx.id,
                help: "open the module's own file in the editor",
              },
            ]),
      ]);
    }
    case "clip":
      // Deliberately NOT the `clip …` family (`clipTargets`): what was right-clicked is an
      // EVENT — a placement on a lane — and the material it references may sit on other lanes
      // too. Offering `clip process` here read as "process this event" while acting on every
      // placement of the file. The material's own verbs stay reachable from the bar and the
      // clip's editor, where the clip is what you are looking at.
      return offer([
        {
          verb: "ui file",
          arg: ctx.id,
          help: "open the clip's own definition in the editor",
        },
        // The `event …` family addresses a PLACEMENT — a track plus a timecode — which is only
        // offered when the caller said where this one sits.
        ...(ctx.track && ctx.tc
          ? from([
              { provider: "tracks", value: ctx.track },
              { kind: "timecode", value: ctx.tc },
            ])
          : []),
      ]);
    case "param": {
      // A param name may contain spaces ("Filter Freq"), and every command here takes it as one
      // argument — the quoting is `fromCatalogue`'s, so no call site has to remember.
      // Two shapes, one control: `node param <node> <param>` sets it and `module cc <module>
      // <param>` binds a knob to it. The first names a USE, the second the module the map
      // follows into every project — so the pair is asked for under both providers, with the
      // same id, which is what a block in the graph is.
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
        // Learn is a UI command, not a brain one: it arms the browser's Web MIDI and waits for a
        // knob. It still goes through the bar like everything else, so the gesture is typeable.
        {
          verb: "ui midi learn",
          arg: quoted,
          help: "bind this param to the next controller knob you touch",
        },
        ...from(target),
        ...from(onModule),
        // The unbind, only worth offering when there is one to remove. It is `module cc` with a
        // value the catalogue cannot express as an argument shape.
        ...(ctx.cc
          ? [
              {
                verb: "module cc",
                arg: `${quoted} none`,
                help: "remove the MIDI binding on this param",
              },
            ]
          : []),
      ]);
    }
    case "take":
      // Written out rather than derived. `<track> <number>` was ALSO the shape of `track
      // normalize`, so asking the catalogue for "commands taking these two" would have offered to
      // normalise a take; that command is gone, but the list stays explicit — a take's two verbs
      // are a menu somebody chose, and the next command to take a track and a number would join
      // it silently.
      return offer([
        { verb: "track take select", arg: `${ctx.track} ${ctx.n}` },
        { verb: "track take delete", arg: `${ctx.track} ${ctx.n}` },
      ]);
    case "chain":
      /**
       * A chain answers no command's first argument — `track process` and `clip process` take
       * one SECOND, and a line cannot be pre-written with a hole in the middle. Its one offer
       * was `project inspect graph`, a READER, and that verb is gone: what it printed is what
       * the pane you right-clicked in is already drawing. So this opens no menu, like `sink`.
       */
      return [];
    case "sink":
      return []; // OUT — nothing per-entity to do
    case "marker-add":
      // A bare timecode: `project marker new <tc> `, leaving the TEXT cursor where the name is typed.
      return offer(from([{ kind: "timecode", value: ctx.tc }]));
    case "marker":
      return build(
        commands,
        from([{ provider: "markerNames", value: ctx.name }]),
      );
  }
}
