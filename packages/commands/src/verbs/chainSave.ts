// chainSave.ts — `chain save [name]`: the bench's run, input to fader, written as one of the account's
// frozen chains (`@account/chains/<name>.k7x`), where the process verbs and the recorder find it. The
// writing is the host's, since only the file service knows the bench and the account's library.
// See packages/file-service/docs/libraries.md and apps/k7/frontend/docs/frozenChains.md.

import type { SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";

export const CHAIN_SAVE_VERBS: Record<string, SidHandler> = {
  "chain.save": (a, h) => {
    const name = splitWords(a)[0];
    if (!h.saveBenchChain) {
      h.refuse([
        "this host keeps no bench — open a chain on the bench to save it",
      ]);
      return;
    }
    try {
      const saved = h.saveBenchChain(h.songPath, name);
      h.log([
        saved.steps
          ? `saved ${saved.ref} (${saved.steps} step${saved.steps === 1 ? "" : "s"}) — clip process <clip> ${saved.ref}`
          : `saved ${saved.ref}: its input alone — the rehearsal recorder records from it`,
        // A module the person sees on the bench and the chain leaves out must be said, never dropped quietly.
        ...(saved.outside.length
          ? [
              `not in it: ${saved.outside.join(", ")} — only what sits between IN and fader is the chain`,
            ]
          : []),
      ]);
    } catch (e) {
      h.refuse([`chain save: ${(e as Error).message}`]);
    }
  },
};
