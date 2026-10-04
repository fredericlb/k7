// historyKeeper.ts — where the undo journal's audio blobs are kept: on the bound engine's MACHINE,
// through its jobs path. A blob is staged in the account's `.history/`, which the binding shares
// with the machine; `prefetch` brings it down there, and `send-up` brings it back for an undo.
// See docs/history.md.

import { existsSync } from "node:fs";
import { askBoundMachine, boundEngine } from "./boundMachine.ts";
import type { BlobKeeper } from "./history.ts";

/** The keeper the service runs: the bound engine's machine, or nothing while none is bound. */
export const engineKeeper: BlobKeeper = {
  engine: boundEngine,
  async keep(files) {
    // The channel downloads every file a request names before the machine sees it; the reply counts them.
    const r = await askBoundMachine({ type: "prefetch", files }, "prefetched");
    return Number(r?.count) === files.length;
  },
  async fetch(file) {
    // The machine names its copy in the reply, which is what uploads it here.
    const r = await askBoundMachine({ type: "send-up", file }, "sent");
    return !!r && existsSync(file);
  },
};
