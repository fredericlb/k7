// useRackTrigger.ts — a rack PAD clicked: audition that sound through `preview`, off the node's
// effective rack in the layout the pane is drawing. One implementation for every pane that draws
// a kit, since a pad that plays in one and is silent in another reads as a broken card.
// The one thing a reader would get wrong: what plays is the material, DRY — see packages/song/docs/racks.md.

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

/** `onTriggerRack` for a pane, reading the layout it draws through a ref so the callback stays stable. */
export function useRackTrigger(
  laid: RefObject<LaidOutGraph | null | undefined>,
): (module: string, symbol: string) => void {
  return useCallback(
    (module: string, symbol: string) => {
      const node = laid.current?.nodes.find(
        (n) => n.kind === "module" && n.module === module,
      );
      const sound = node?.rack?.find((s) => s.symbol === symbol);
      const req = sound ? rackPreviewReq(sound) : null;
      // A symbol with no material at all is already reported against the file, so there is nothing to add here.
      if (!req) return;
      // …but one whose material does not RESOLVE is worth a word: a pad that lights and stays silent reads as broken.
      void api
        .preview(req)
        .catch((e: Error) =>
          showToast({ message: `${symbol}: ${e.message}`, variant: "error" }),
        );
    },
    [laid],
  );
}
