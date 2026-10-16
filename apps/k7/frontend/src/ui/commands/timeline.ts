// timeline.ts — the arrangement's and the clip grids' own verbs: the tool a press means, the
// selection, the zoom stack, the header toggles, and the rectangle's copy, paste, delete and
// split. The state lives in TimelineTab and the grids; these reach it through their handles.

import { m } from "../../paraglide/messages.js";
import { isRollMode, ROLL_MODES, ROLL_PRESS } from "../../rollMode";
import { isTool, TOOLS } from "../../timelineTools";
import { isWaveMode, WAVE_MODES } from "../../waveMode";
import type { LocalCommand, LocalCtx } from "./context";

/** The selection, the loop and `t` belong to whichever grid is ON SCREEN. */
export const clipGridOf = (ctx: LocalCtx) =>
  ctx.shownSlot?.kind === "clip" ? ctx.clipGridRef.current : null;

/** A command whose whole job is one call on the timeline's handle. */
const onTimeline = (
  name: string,
  readable: { en: string; fr: string },
  act: (ctx: LocalCtx) => void,
): LocalCommand => ({
  name,
  readable,
  run: (ctx) => {
    act(ctx);
    return true;
  },
});

export const TIMELINE_COMMANDS: LocalCommand[] = [
  {
    // The tool belongs to the SURFACE; only the timeline holds tools today (docs/timeline.md).
    name: "ui tool",
    readable: {
      en: "Choose what a press does on this surface",
      fr: "Choisir ce que fait un clic sur cette surface",
    },
    args: [
      {
        name: "tool",
        kind: "choice",
        hint: "pointer · cut · erase · mute · crossfade",
      },
    ],
    match: "names",
    run: (ctx, _rest, lower) => {
      const want = lower.trim();
      if (!isTool(want)) {
        ctx.setStatus(
          m["status.unknownTool"]({ tool: want, tools: TOOLS.join(" · ") }),
        );
        return true;
      }
      ctx.timelineRef.current?.setTool(want);
      ctx.setStatus(
        want === "pointer"
          ? m["status.toolPointer"]()
          : m["status.tool"]({ tool: want }),
      );
      return true;
    },
  },
  {
    // The waveform's picture and its gestures are ONE thing, so one verb sets both (waveMode.ts).
    name: "ui wave",
    readable: {
      en: "Choose what the waveform is for",
      fr: "Choisir à quoi sert la forme d'onde",
    },
    args: [
      {
        name: "view",
        kind: "choice",
        hint: "standard · onsets · warp · takes",
      },
    ],
    match: "names",
    run: (ctx, _rest, lower) => {
      const want = lower.trim();
      if (!isWaveMode(want)) {
        ctx.setStatus(
          m["status.unknownView"]({
            view: want,
            views: WAVE_MODES.join(" · "),
          }),
        );
        return true;
      }
      if (!ctx.waveRef.current) {
        ctx.setStatus(m["status.noAudioClip"]());
        return true;
      }
      ctx.waveRef.current.setView(want);
      return true;
    },
  },
  {
    // Where a press on the piano roll goes: select, create, remove (rollMode.ts).
    name: "ui roll",
    readable: {
      en: "Choose what a press does on the piano roll",
      fr: "Choisir ce que fait un clic sur le piano roll",
    },
    args: [
      {
        name: "mode",
        kind: "choice",
        hint: "select · create · remove · takes",
      },
    ],
    match: "names",
    run: (ctx, _rest, lower) => {
      const want = lower.trim();
      if (!isRollMode(want)) {
        ctx.setStatus(
          m["status.unknownMode"]({
            mode: want,
            modes: ROLL_MODES.join(" · "),
          }),
        );
        return true;
      }
      if (!ctx.rollRef.current) {
        ctx.setStatus(m["status.noPianoRoll"]());
        return true;
      }
      ctx.rollRef.current.setMode(want);
      ctx.setStatus(`${want} — ${ROLL_PRESS[want]()}`);
      return true;
    },
  },
  {
    name: "ui select",
    readable: {
      en: "Switch between the caret and a selection",
      fr: "Basculer entre le curseur et une sélection",
    },
    run: (ctx) => {
      const grid = clipGridOf(ctx);
      if (grid) grid.toggleSelect();
      else ctx.timelineRef.current?.toggleSelect();
      return true;
    },
  },
  onTimeline(
    "ui zoom",
    {
      en: "Frame the timeline on the selection",
      fr: "Cadrer la timeline sur la sélection",
    },
    (ctx) => ctx.timelineRef.current?.zoomIn(),
  ),
  onTimeline(
    "ui zoom out",
    { en: "Zoom back out one step", fr: "Revenir d'un cran en arrière" },
    (ctx) => ctx.timelineRef.current?.zoomOut(),
  ),
  onTimeline(
    "ui zoom reset",
    { en: "Show the whole song", fr: "Afficher tout le morceau" },
    (ctx) => ctx.timelineRef.current?.zoomReset(),
  ),
  onTimeline(
    "ui ruler",
    {
      en: "Read the ruler in bars or in seconds",
      fr: "Lire la règle en mesures ou en secondes",
    },
    (ctx) => ctx.timelineRef.current?.toggleRuler(),
  ),
  onTimeline(
    "ui lanes",
    {
      en: "Show what the clips hold, in the lanes",
      fr: "Afficher le contenu des clips dans les pistes",
    },
    (ctx) => ctx.timelineRef.current?.toggleLanes(),
  ),
  onTimeline(
    "ui automation",
    {
      en: "Show or hide the automation lanes",
      fr: "Afficher ou masquer les pistes d'automation",
    },
    (ctx) => ctx.timelineRef.current?.toggleAutomation(),
  ),
  // Bare: the backend's `event move` takes three args, so a line WITH them still reaches it.
  onTimeline(
    "event move",
    {
      en: "Move a clip to another position or track",
      fr: "Déplacer un clip à une autre position ou piste",
    },
    (ctx) => ctx.timelineRef.current?.startMove(),
  ),
  {
    // The clip pane first, and the timeline WHEN IT HAS NOTHING — the one verb of the four that falls through (docs/clipEditors.md).
    name: "selection copy",
    readable: {
      en: "Copy the selected events or notes",
      fr: "Copier les événements ou notes sélectionnés",
    },
    run: (ctx) => {
      const got =
        clipGridOf(ctx)?.copy() ?? ctx.timelineRef.current?.copy() ?? null;
      if (!got) {
        // The caret is a rectangle too, so reaching here means it was parked on nothing.
        ctx.setStatus(m["status.nothingToCopy"]());
        return true;
      }
      ctx.setClipboard(got);
      ctx.setStatus(
        got.kind === "notes"
          ? m["status.copiedNotes"]({ count: got.notes.length })
          : m["status.copiedEvents"]({ count: got.events.length }),
      );
      return true;
    },
  },
  {
    // The CLIPBOARD says which surface, having been copied as events or as notes (clipboard.ts).
    name: "selection paste",
    readable: {
      en: "Paste what was copied at the caret",
      fr: "Coller ce qui a été copié au curseur",
    },
    run: (ctx) => {
      const held = ctx.clipboardRef.current;
      if (!held) {
        ctx.setStatus(m["status.clipboardEmpty"]());
        return true;
      }
      const notes = held.kind === "notes";
      const pane = notes ? ctx.clipGridRef.current : ctx.timelineRef.current;
      if (!pane) {
        ctx.setStatus(
          notes ? m["status.noClipForNotes"]() : m["status.noTimeline"](),
        );
        return true;
      }
      const out = pane.pasteLine(held);
      if (out.line) void ctx.runCommand(out.line);
      ctx.setStatus(out.note);
      return true;
    },
  },
  {
    // Whichever surface holds a RECTANGLE, the clip grid first; with none, the open grid's caret, else the timeline's.
    name: "selection delete",
    readable: {
      en: "Delete the selected notes or events",
      fr: "Supprimer les notes ou événements sélectionnés",
    },
    run: (ctx) => {
      const clipGrid = clipGridOf(ctx);
      const grid = clipGrid?.deleteLine ? clipGrid : null;
      // The timeline stays mounted off screen: only the one in FRONT may lose an event to a key.
      const timeline =
        ctx.activePane === "timeline" ? ctx.timelineRef.current : null;
      const pane =
        grid && ctx.clipSel
          ? grid
          : timeline && ctx.timelineSelecting
            ? timeline
            : (grid ?? timeline);
      const out = pane?.deleteLine?.();
      if (!out) {
        ctx.setStatus(m["status.nothingToDelete"]());
        return true;
      }
      if (out.line) void ctx.runCommand(out.line);
      ctx.setStatus(out.note);
      return true;
    },
  },
  {
    // The blade at the PLAYHEAD, on the caret's lane — the same line the cut tool makes (docs/timeline.md).
    name: "selection split",
    readable: {
      en: "Split the clip under the playhead",
      fr: "Couper le clip sous la tête de lecture",
    },
    run: (ctx) => {
      const out = ctx.timelineRef.current?.splitLine(
        ctx.store.getSnapshot().playhead,
      );
      if (out?.line) void ctx.runCommand(out.line);
      ctx.setStatus(out?.note ?? m["status.nothingToSplit"]());
      return true;
    },
  },
];
