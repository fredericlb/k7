// portProbe.ts — is anything answering on a loopback port? A socket and a timer, nothing more.
// Shared because both halves the supervisor watches ask it: the file service before spawning
// one, and the engine before believing a pidfile. See docs/supervisorPolicy.md.

import { createConnection } from "node:net";

const PROBE_TIMEOUT_MS = 300;

/** Is something serving on this loopback port? Never "is it OURS" — a port is not an identity, and `whoami` is what settles that. */
export function isServing(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (up: boolean): void => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(up);
    };
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
