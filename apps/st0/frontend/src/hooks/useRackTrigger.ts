// useRackTrigger.ts — a rack PAD clicked: audition that sound through `preview`, off the node's
// effective rack in the layout the pane is drawing. One implementation for every pane that draws
// a kit, since a pad that plays in one and is silent in another reads as a broken card.
// The one thing a reader would get wrong: what plays is the material, DRY — see packages/song/docs/racks.md —
// except an SFZ KIT's pad, which has no file: its note goes through the node's own lane, kit and chain.

import { showToast } from "@studio/project-shell/toast";
import type { LaidOutGraph } from "@studio/ui-chains/graph";
import { type RefObject, useCallback } from "react";
import { api } from "../api";
import type { PreviewReq } from "../types";

/** What a sound auditions as: its resolved file (a library sample or a clip), else its slice window, else nothing. */
export function rackPreviewReq(sound: {
  clip?: string;
  source?: string;
  from?: number;
  to?: number;
}): PreviewReq | null {
  // `kind: "source"` and not `"clip"`: `resolveRackAudio` has already rewritten a sample or a clip to a path.
  if (sound.clip) return { kind: "source", source: sound.clip };
  if (sound.source)
    return {
      kind: "slice",
      source: sound.source,
      from: sound.from ?? 0,
      to: sound.to ?? 0,
    };
  return null;
}

/** The engine lane a node plays on: its plugin id is `<lane>:<node>` (packages/song's nodeProject). */
export function laneOfPlugin(
  pluginId: string | undefined,
  module: string,
): string | null {
  const tail = `:${module}`;
  return pluginId?.endsWith(tail) ? pluginId.slice(0, -tail.length) : null;
}

/** How hard a kit's pad is struck when clicked: firm, short of the top layer. */
const PAD_VELOCITY = 100 / 127;

/** `onTriggerRack` for a pane, reading the layout it draws through a ref so the callback stays stable. */
export function useRackTrigger(
  laid: RefObject<LaidOutGraph | null | undefined>,
  previewNote?: (track: string, key: number, vel: number) => void,
  // Light the pad that was clicked: the engine reports no notes, so the audition is shown here (rackLit.ts).
  flash?: (module: string, note: number) => void,
): (module: string, symbol: string) => void {
  return useCallback(
    (module: string, symbol: string) => {
      const node = laid.current?.nodes.find(
        (n) => n.kind === "module" && n.module === module,
      );
      const sound = node?.rack?.find((s) => s.symbol === symbol);
      // A kit's pad is its NOTE, played through the node: the full kit, velocity layers and all.
      if (node?.rackKit && sound) {
        const lane = laneOfPlugin(node.pluginId, module);
        if (lane && previewNote) {
          previewNote(lane, sound.note, PAD_VELOCITY);
          flash?.(module, sound.note);
        }
        return;
      }
      const req = sound ? rackPreviewReq(sound) : null;
      // A symbol with no material at all is already reported against the file, so there is nothing to add here.
      if (!req || !sound) return;
      flash?.(module, sound.note);
      // …but one whose material does not RESOLVE is worth a word: a pad that lights and stays silent reads as broken.
      void api
        .preview(req)
        .catch((e: Error) =>
          showToast({ message: `${symbol}: ${e.message}`, variant: "error" }),
        );
    },
    [laid, previewNote, flash],
  );
}
