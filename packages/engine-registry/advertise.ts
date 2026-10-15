// advertise.ts — how a hosted service says "I am running here" on this machine.
// One file per service under ~/.k7/web-endpoints/, written on boot and removed on
// shutdown. The file service reads pl8's to find the médiathèque; the supervisor does NOT
// heartbeat to these — an engine joins an instance only when the user adds it. See docs/shared.md.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { webEndpointsDir } from "@studio/engine-client/paths";

/** A service name as a filename — the slug is the identity, so two boots of one service replace rather than pile up. */
const clean = (s: string): string =>
  s.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "service";

/** Advertise this service's registry and return the goodbye; failure is swallowed, since an unwritable `~/.k7` must not stop a boot. See docs/shared.md. */
export function advertiseRegistry(service: string, url: string): () => void {
  const path = join(webEndpointsDir(), `${clean(service)}.json`);
  try {
    mkdirSync(webEndpointsDir(), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ service, url })}\n`, "utf8");
  } catch {
    /* unwritable — see above */
  }
  return () => {
    try {
      rmSync(path);
    } catch {
      /* already gone, or never written */
    }
  };
}
