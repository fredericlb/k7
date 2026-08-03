// advertise.ts — how a hosted service tells the engine-host supervisor "my registry is here".
// One file per service under ~/.studio/web-endpoints/, written on boot and removed on
// shutdown; the supervisor heartbeats to every URL it finds. See docs/shared.md.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { webEndpointsDir } from "@studio/engine-client/paths";

/** A service name as a filename — the slug is the identity, so two boots of one service replace rather than pile up. */
const clean = (s: string): string =>
  s.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "service";

/**
 * Advertise this service's registry, and return the goodbye.
 *
 * Every service holds its OWN registry (see docs/shared.md), so an engine has to heartbeat to
 * all of them to be pickable in all of them. This used to be a single `web-endpoint.json`
 * holding one URL, which only pistes ever wrote — so an engine was listed in pistes and
 * invisible in the médiathèque and the decks, which had registries nobody ever announced to.
 *
 * Failure is swallowed on purpose: an unwritable `~/.studio` must not stop a backend booting,
 * and the supervisor can still be pointed at a registry with `$STUDIO_REGISTRY_URL`.
 */
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
