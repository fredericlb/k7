// ports.ts — the ports this app opens, all free ones in its own range, and the ones it took last time tried first.
// Kept because a page's storage is keyed on its ORIGIN, port included: a moving port would empty it (docs/standalone.md).
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freePort, type PortRange } from "@studio/file-hub/ports";

/** Every port the app, its backend, its file services and its engine open falls in here. */
export const PORT_RANGE: PortRange = { first: 22000, last: 23000 };

/** The ports of this launch: k7's backend, which is the pages' origin, and the first one the engine tries. */
export interface AppPorts {
  k7: number;
  engine: number;
}

/** Written beside the rest of the state, and read back by the e2e launcher to find the app. */
export const portsFile = (root: string): string => join(root, "ports.json");

function kept(root: string): Partial<AppPorts> {
  try {
    return JSON.parse(
      readFileSync(portsFile(root), "utf8"),
    ) as Partial<AppPorts>;
  } catch {
    return {};
  }
}

/** Free ports for this launch, last launch's when they still are, and recorded for the next. */
export async function choosePorts(
  root: string,
  range: PortRange = PORT_RANGE,
): Promise<AppPorts> {
  const last = kept(root);
  // A k7 that has to move leaves the engine's last port alone, so one taken port moves one service.
  const k7 = await freePort(
    range,
    last.k7 ? [last.k7] : [],
    last.engine ? [last.engine] : [],
  );
  const engine = await freePort(range, last.engine ? [last.engine] : [], [k7]);
  const ports = { k7, engine };
  const tmp = `${portsFile(root)}.tmp`;
  writeFileSync(tmp, JSON.stringify(ports, null, 2));
  renameSync(tmp, portsFile(root));
  return ports;
}
