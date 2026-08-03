// contextMenu.ts — the right-click entries for a timeline/graph entity. Each PRE-WRITES a
// command into the bar and never runs one. Lines are built canonical (what the dispatcher
// understands) then localized for both the label and the text dropped in, arguments
// untouched — so the menu shows the names the bar's completion offers, and Enter runs what
// you see.

import { localizeCommand, localizeCommandLine } from "./commandI18n";

// What the cursor was over. `id` is the entity as commands name it: a track/module id, a clip's ref, a chain name.
export type MenuCtx =
  | { kind: "track"; id: string }
  | { kind: "group"; id: string }
  // A "block" in the graph. `missing` means no file, no plugin and no param — the menu shrinks to what still
  // applies. `ambient` means the ENGINE provides it and nothing is on disk: it can be given a folder.
  | { kind: "module"; id: string; missing?: boolean; ambient?: boolean }
  // A placed clip. `track` + `tc` say WHICH placement, the pair `event move`/`event remove` address; both optional.
  | { kind: "clip"; id: string; midi: boolean; track?: string; tc?: string }
  | { kind: "chain"; id: string; track?: string }
  | { kind: "sink"; id: string }
  // Right-click on the timeline ruler at `tc` (a timecode) — offer to drop a marker.
  | { kind: "marker-add"; tc: string }
  // Right-click on an existing marker — offer to delete it by name.
  | { kind: "marker"; name: string };

// A canonical entry: `verb` the command, `arg` its entity, `needsMore` a trailing space when a value is still owed.
interface Entry {
  verb: string;
  arg?: string;
  needsMore?: boolean;
}

// A displayable menu item: the localized label, and the localized line to pre-write.
export interface MenuItem {
  label: string;
  command: string;
}

const build = (entries: Entry[]): MenuItem[] =>
  entries.map((e) => {
    const line = e.arg ? `${e.verb} ${e.arg}` : e.verb;
    return {
      label: localizeCommand(e.verb),
      command: localizeCommandLine(line) + (e.needsMore ? " " : ""),
    };
  });

// The menu for a context; empty means "don't open a menu here" (a sink has no command worth offering).
export function contextMenu(ctx: MenuCtx): MenuItem[] {
  switch (ctx.kind) {
    case "track":
      return build([
        { verb: "track gain", arg: ctx.id, needsMore: true },
        { verb: "track pan", arg: ctx.id, needsMore: true },
        { verb: "track mute", arg: ctx.id },
        { verb: "track solo", arg: ctx.id },
        { verb: "track rec", arg: ctx.id },
        // The only offer on a frozen lane worth making, and the only one that reaches it: the clip menu steps
        // aside for the track menu there (see TimelineTab), so this is where an unfreeze is found.
        { verb: "track freeze", arg: ctx.id },
        { verb: "project inspect timeline", arg: ctx.id },
        { verb: "project inspect graph", arg: ctx.id },
        { verb: "ui file", arg: ctx.id }, // open tracks/<id>.yaml
      ]);
    case "group":
      // A group has no lane of its own — only its mute/solo flags apply.
      return build([
        { verb: "track mute", arg: ctx.id },
        { verb: "track solo", arg: ctx.id },
      ]);
    case "module":
      // A dangling reference: bypass acts on chains.yaml, so it is the one verb that still works without the module existing.
      if (ctx.missing) return build([{ verb: "module bypass", arg: ctx.id }]);
      return build([
        { verb: "module open", arg: ctx.id }, // the native plugin UI (external plugins)
        { verb: "module param", arg: ctx.id, needsMore: true },
        // A module the engine merely reports has no file to open — `module own` is what gives it one, and
        // therefore the only way it ever gets a panel or presets. Offered instead of `ui file`, not beside it.
        ctx.ambient
          ? { verb: "module own", arg: ctx.id }
          : { verb: "ui file", arg: ctx.id }, // open the module's file
      ]);
    case "clip":
      // `file` opens the clip that was right-clicked, unlike `edit clip`, which follows the caret. `event remove`/`move`
      // need the PLACEMENT, so they appear only when the caller said where this one sits; removing leaves the clip.
      return build([
        { verb: "ui file", arg: ctx.id },
        ...(ctx.track && ctx.tc
          ? [
              {
                verb: "event move",
                arg: `${ctx.track} ${ctx.tc}`,
                needsMore: true,
              },
              { verb: "event remove", arg: `${ctx.track} ${ctx.tc}` },
            ]
          : []),
      ]);
    case "chain":
      // A chain has no command of its own; offer to inspect the graph for the track it carries, when that's known.
      return build(
        ctx.track ? [{ verb: "project inspect graph", arg: ctx.track }] : [],
      );
    case "sink":
      return []; // OUT — nothing per-entity to do
    case "marker-add":
      // Pre-writes `marker new <tc> ` with the caret left for the name to type.
      return build([{ verb: "marker new", arg: ctx.tc, needsMore: true }]);
    case "marker":
      return build([{ verb: "marker delete", arg: ctx.name }]);
  }
}
