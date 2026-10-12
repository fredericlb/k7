// boot.ts — what a desktop app checks and keeps on this machine before it starts its servers.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";

/** Whether something already answers on `port` — a dev session, or a second copy of the app. */
export function portBusy(port: number): Promise<boolean> {
  return new Promise((res) => {
    const s = createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => {
      s.destroy();
      res(true);
    });
    s.once("error", () => res(false));
  });
}

/** Throws, naming the first port of `ports` that something already holds. */
export async function assertPortsFree(ports: number[]): Promise<void> {
  for (const port of ports)
    if (await portBusy(port))
      throw new Error(
        `port ${port} is already in use — is another copy of the app still running?`,
      );
}

/** A secret generated once and kept in `dir`, so a restart keeps every session signed with it. */
export function persistentSecret(dir: string, name = "session-secret"): string {
  const at = join(dir, name);
  if (existsSync(at)) return readFileSync(at, "utf8").trim();
  const s = randomBytes(32).toString("hex");
  writeFileSync(at, s, { mode: 0o600 });
  return s;
}
