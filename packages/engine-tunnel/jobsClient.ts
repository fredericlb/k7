// jobsClient.ts — asking an engine's MACHINE to do something, over a jobs channel: one request,
// its replies as they come, the last one settling it. The socket is either a TunnelChannel (a
// process holding the hub) or a `ws` WebSocket to a bound loopback path (a hosted file service).
// See docs/jobs.md.

import { randomBytes } from "node:crypto";

/** What both kinds of socket offer, and all this uses. */
export interface JobSocket {
  readyState: number;
  send(data: string): void;
  on(ev: "message", fn: (data: Buffer | string) => void): unknown;
  on(ev: "close", fn: () => void): unknown;
  once(ev: "open", fn: () => void): unknown;
  off(ev: "message", fn: (data: Buffer | string) => void): unknown;
  off(ev: "close", fn: () => void): unknown;
}

export type JobReply = Record<string, unknown> & { type: string; id?: string };

/** Thrown for a reply of type `error`, or a channel that closed before the last reply. */
export class JobError extends Error {}

/** Send `body` and resolve with the reply `isLast` accepts; every reply is shown to `onReply` first. */
export function requestJob(
  sock: JobSocket,
  body: Record<string, unknown> & { type: string },
  isLast: (reply: JobReply) => boolean,
  onReply?: (reply: JobReply) => void,
): Promise<JobReply> {
  const id = randomBytes(8).toString("hex");
  return new Promise((resolve, reject) => {
    const done = (): void => {
      sock.off("message", onMessage);
      sock.off("close", onClose);
    };
    const onMessage = (data: Buffer | string): void => {
      let reply: JobReply;
      try {
        reply = JSON.parse(data.toString());
      } catch {
        return;
      }
      // The machine's word is not trusted for shape: `null` or a number is no reply.
      if (typeof reply !== "object" || reply === null || reply.id !== id)
        return;
      if (reply.type === "error") {
        done();
        reject(
          new JobError(String(reply.error ?? "the engine's machine refused")),
        );
        return;
      }
      try {
        onReply?.(reply);
        if (!isLast(reply)) return;
      } catch (e) {
        done();
        reject(e);
        return;
      }
      done();
      resolve(reply);
    };
    const onClose = (): void => {
      done();
      reject(new JobError("the engine's machine went away before answering"));
    };
    sock.on("message", onMessage);
    sock.on("close", onClose);
    const send = (): void => sock.send(JSON.stringify({ ...body, id }));
    if (sock.readyState === 1) send();
    else sock.once("open", send);
  });
}
