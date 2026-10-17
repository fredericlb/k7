// transport.ts — the transport verbs the shell answers itself: the ones that need the caret or
// the selection, and the bare five it sends over the ENGINE's socket for latency rather than
// through the file service (docs/shell.md). None is `ui`: `ui` promises not to move the transport.

import type { TransportAction } from "@studio/engine-protocol";
import { m } from "../../paraglide/messages.js";
import type { LocalCommand, LocalCtx } from "./context";
import { clipGridOf } from "./timeline";

/** The transport verbs the shell answers over the ENGINE's socket instead of the file service — measured at ~110 ms through it (docs/shell.md). */
export const BARE_TRANSPORT: readonly string[] = [
  "transport play",
  "transport stop",
  "transport toggle",
  "transport rewind",
  // Panic too: it is what you type when the sound will not stop, and the file service is the slow road exactly when something is wedged.
  "transport panic",
];

/** Play in record mode with nothing armed records nothing: refused, with the way out — the button's own sentence. */
const refusedForNoArm = (ctx: LocalCtx): boolean => {
  if (!ctx.recordWithoutArmRef.current || ctx.store.getSnapshot().playing)
    return false;
  ctx.setRefusal(m["transport.noArm"]());
  return true;
};

const step = (
  dir: 1 | -1,
  name: string,
  readable: { en: string; fr: string },
): LocalCommand => ({
  // One snap position, the ticks the timeline draws: a FRAME once it is zoomed in on a picture (docs/timeline.md).
  name,
  readable,
  run: (ctx) => {
    const to = ctx.timelineRef.current?.stepTarget(
      ctx.store.getSnapshot().playhead,
      dir,
    );
    if (to !== null && to !== undefined) ctx.seek(to);
    return true;
  },
});

export const TRANSPORT_COMMANDS: LocalCommand[] = [
  {
    name: "transport locate",
    readable: {
      en: "Move the playhead to the caret",
      fr: "Placer la tête de lecture sur le curseur",
    },
    run: (ctx) => {
      const grid = clipGridOf(ctx);
      if (grid) grid.seekToCaret();
      else ctx.timelineRef.current?.seekToCaret();
      return true;
    },
  },
  {
    // The clip pane's only when IT holds the selection, as Shift+L's conditions say (docs/clipEditors.md).
    name: "transport loop",
    readable: {
      en: "Loop the selection, or clear the loop",
      fr: "Boucler la sélection, ou annuler la boucle",
    },
    run: (ctx) => {
      const grid = clipGridOf(ctx);
      if (grid && ctx.clipSel) grid.toggleLoop();
      else ctx.timelineRef.current?.toggleLoop();
      return true;
    },
  },
  {
    // Over the wire, reading the live snapshot so it always flips the current state.
    name: "transport record",
    readable: {
      en: "Turn the global record enable on or off",
      fr: "Activer ou désactiver l'enregistrement global",
    },
    run: (ctx) => {
      ctx.engineRef.current?.setRecordEnabled(
        !ctx.store.getSnapshot().recordEnabled,
      );
      return true;
    },
  },
  {
    // Back to where playback last started, then rolls again — `play` is not a toggle.
    name: "transport replay",
    readable: {
      en: "Play again from where playback last started",
      fr: "Rejouer depuis le dernier départ de lecture",
    },
    run: (ctx) => {
      if (refusedForNoArm(ctx)) return true;
      ctx.seek(ctx.replayAtRef.current);
      // Deliberately the BARE verb: the seek above has already chosen a position.
      ctx.transport("play");
      return true;
    },
  },
  step(1, "transport step next", {
    en: "Step the playhead to the next grid position",
    fr: "Avancer la tête de lecture d’un pas de grille",
  }),
  step(-1, "transport step prev", {
    en: "Step the playhead back one grid position",
    fr: "Reculer la tête de lecture d’un pas de grille",
  }),
  // The server's catalogue lists these five; the shell only takes the faster road to them.
  ...BARE_TRANSPORT.map(
    (name): LocalCommand => ({
      name,
      listed: false,
      run: (ctx) => {
        if (name === "transport play" && refusedForNoArm(ctx)) return true;
        // On a snapshot there IS no slow path: `transport` is already the browser player, so it always answers.
        if (!ctx.frozen && (!ctx.connected || ctx.engineBusyRef.current))
          return false;
        ctx.transport(name.slice("transport ".length) as TransportAction);
        return true;
      },
    }),
  ),
];
