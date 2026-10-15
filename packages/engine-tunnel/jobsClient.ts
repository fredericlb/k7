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
  /** Ends the channel when a job runs out of time; both kinds of socket have it. */
  close?(): void;
}

/** A job is given up after this long in all, whatever it says on the way. */
export const JOB_TIMEOUT_MS = 60 * 60_000;
/** …or after this long without a reply: a render says `rendering` once and then nothing until done. */
export const JOB_IDLE_MS = 15 * 60_000;

export interface JobTimeouts {
  totalMs?: number;
  idleMs?: number;
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
  { totalMs = JOB_TIMEOUT_MS, idleMs = JOB_IDLE_MS }: JobTimeouts = {},
): Promise<JobReply> {
  const id = randomBytes(8).toString("hex");
  return new Promise((resolve, reject) => {
    let idle: NodeJS.Timeout | undefined;
    const done = (): void => {
      clearTimeout(total);
      clearTimeout(idle);
      sock.off("message", onMessage);
      sock.off("close", onClose);
    };
    // Timed out, the channel is closed too: a machine still working would otherwise answer into nothing.
    const expire = (why: string): void => {
      done();
      try {
        sock.close?.();
      } catch {
        /* already closing */
      }
      reject(new JobError(why));
    };
    const total = setTimeout(
      () =>
        expire(
          `the engine's machine did not finish within ${totalMs / 60_000} min`,
        ),
      totalMs,
    );
    const quiet = (): void => {
      clearTimeout(idle);
      idle = setTimeout(
        () =>
          expire(
            `the engine's machine said nothing for ${idleMs / 60_000} min`,
          ),
        idleMs,
      );
    };
    quiet();
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
      quiet();
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
