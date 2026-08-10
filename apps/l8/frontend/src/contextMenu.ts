// contextMenu.ts — the right-click entries for a timeline/graph entity. Each PRE-WRITES a
// command into the bar and never runs one. The list is DERIVED from the command catalogue:
// whatever was clicked says which type it can answer for, and every command whose leading
// arguments are exactly that is offered. See docs/contextMenu.md.

import { localizeCommand, localizeCommandLine } from "./commandI18n";
import type { ArgClass, ArgProvider, CommandInfo } from "./types";

// What the cursor was over. `id` is the entity as commands name it: a track/module id, a clip's ref, a chain name.
export type MenuCtx =
  | { kind: "track"; id: string }
  | { kind: "group"; id: string }
  // A "block" in the graph. `missing` means no file, no plugin and no param — the menu shrinks to what still
  // applies. `ambient` means the ENGINE provides it and nothing is on disk: it can be given a folder.
  | { kind: "module"; id: string; missing?: boolean; ambient?: boolean }
  // A placed clip. `track` + `tc` say WHICH placement, so the `event …` family can be offered; both optional.
  | { kind: "clip"; id: string; midi: boolean; track?: string; tc?: string }
  // One control on a module, right-clicked: `param` is the widget's `bind`, `cc` what is already
  // mapped to it. A binding is per param, so this is its own kind rather than part of "module".
  | {
      kind: "param";
      id: string;
      param: string;
      label: string;
      cc?: { ch: number; cc: number };
    }
  | { kind: "chain"; id: string; track?: string }
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

// A displayable menu item: what the command DOES, and the localized line to pre-write.
export interface MenuItem {
  label: string;
  command: string;
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
  // `module param <module> <param>` and `module clone <module> <newName>` are the SAME shape —
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

const build = (commands: CommandInfo[], entries: Entry[]): MenuItem[] =>
  entries.map((e) => {
    const line = e.arg ? `${e.verb} ${e.arg}` : e.verb;
    const help =
      e.help ?? commands.find((c) => c.command === e.verb)?.help ?? "";
    return {
      // What it does, not what it is called. The command itself is still shown beside it (see
      // ContextMenu.tsx) — the menu's contract is that it pre-writes a line, and hiding the line
      // would make that opaque.
      label: readable(help) || localizeCommand(e.verb),
      command: localizeCommandLine(line) + (e.needsMore ? " " : ""),
    };
  });

// The verbs that still mean something on a node NOTHING answers to. Both act on chains.yaml
// alone, which is why they survive; the catalogue cannot say this, since it describes arguments
// and this is about what the handler touches.
const SURVIVES_MISSING = new Set(["module bypass", "module instance unlink"]);

/** The menu for a context; empty means "don't open a menu here". */
export function contextMenu(ctx: MenuCtx, commands: CommandInfo[]): MenuItem[] {
  const from = (slots: Slot[]): Entry[] => fromCatalogue(commands, slots);
  switch (ctx.kind) {
    case "track":
      return build(commands, [
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
      return build(commands, [
        { verb: "track mute", arg: ctx.id },
        { verb: "track solo", arg: ctx.id },
      ]);
    case "module": {
      const own = from([{ provider: "modules", value: ctx.id }]);
      if (ctx.missing)
        return build(
          commands,
          own.filter((e) => SURVIVES_MISSING.has(e.verb)),
        );
      return build(commands, [
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
      return build(commands, [
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
        // Anything taking the clip ITSELF. Audio only: `clipTargets` lists no MIDI, and the
        // handler refuses one by name — never offer what the command would reject.
        ...(ctx.midi ? [] : from([{ provider: "clipTargets", value: ctx.id }])),
      ]);
    case "param": {
      // A param name may contain spaces ("Filter Freq"), and every command here takes it as one
      // argument — the quoting is `fromCatalogue`'s, so no call site has to remember.
      const target: Slot[] = [
        { provider: "modules", value: ctx.id },
        { kind: "text", name: "param", value: ctx.param },
      ];
      const quoted = `${ctx.id} ${quoteArg(ctx.param)}`;
      return build(commands, [
        // Learn is a UI command, not a brain one: it arms the browser's Web MIDI and waits for a
        // knob. It still goes through the bar like everything else, so the gesture is typeable.
        {
          verb: "ui midi learn",
          arg: quoted,
          help: "bind this param to the next controller knob you touch",
        },
        ...from(target),
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
    case "chain":
      // A chain answers no command's first argument — `track process` and `clip process` take one
      // SECOND, and a line cannot be pre-written with a hole in the middle. So the only offer is
      // about the track it carries, which is why this one is written out rather than derived.
      return build(
        commands,
        ctx.track ? [{ verb: "project inspect graph", arg: ctx.track }] : [],
      );
    case "sink":
      return []; // OUT — nothing per-entity to do
    case "marker-add":
      // A bare timecode: `marker new <tc> `, leaving the TEXT cursor where the name is typed.
      return build(commands, from([{ kind: "timecode", value: ctx.tc }]));
    case "marker":
      return build(
        commands,
        from([{ provider: "markerNames", value: ctx.name }]),
      );
  }
}
