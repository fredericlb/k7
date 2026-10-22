// followPairings.ts — the machine's engine follows its accounts' pairings: a server paired lists the engine there
// with the device token that server minted, so its heartbeats name the account its owner; a pairing let go
// unlists it. The servers paired before this existed are listed ONCE, then never again: an engine the musician
// removed from a server keeps syncing without being listed back at the next start. See ../../docs/localEngine.md.

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pairedServers } from "@studio/file-hub/sync-remote";
import type { LocalEngine } from "./host.ts";

/** U+001F joins the origin and the token `weburi.pair` takes (engine/k7-supervisor/docs/hostProtocol.md). */
const SEP = "\u001f";

/** Under the files root: the servers already paired have been handed to the engine once. */
const BACKFILLED = ".engine-pairings-listed";

/** What the file hub calls as a pairing is stored or let go. */
export function pairingHooks(engine: LocalEngine) {
  return {
    onPaired: (origin: string, token: string) =>
      engine.send("weburi.pair", `${origin}${SEP}${token}`),
    onForgotten: (origin: string) => {
      if (origin) engine.send("weburi.remove", origin);
    },
  };
}

/** Once the supervisor answers, the pairings made before the engine followed them, listed; once per files root. */
export function listPairedOnce(engine: LocalEngine, dataRoot: string): void {
  const marker = join(dataRoot, BACKFILLED);
  if (existsSync(marker)) return;
  const hooks = pairingHooks(engine);
  const off = engine.subscribe((s) => {
    if (!s.snapshot) return;
    off();
    for (const p of pairedServers(dataRoot)) hooks.onPaired(p.origin, p.token);
    try {
      writeFileSync(marker, `${new Date().toISOString()}\n`);
    } catch {
      // An unwritable root lists them again at the next start, which re-pairs nothing new.
    }
  });
}
