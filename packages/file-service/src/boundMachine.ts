// boundMachine.ts — the jobs path of the engine machine this account is bound to, as the hub last
// said: where separations run, set lists land, the Logs panel reads and the machine's own settings
// live. Its own module because `hosted.ts` refuses to load without a hub secret, and a route must be
// importable without one.

import { requestJob } from "@studio/engine-tunnel/jobs-client";
import { WebSocket } from "ws";

let jobsUrl: string | null = null;

/** The bound machine's jobs path, or null while no engine is bound. */
export function boundJobsUrl(): string | null {
  return jobsUrl;
}

/** Set by the hub's binding route, and only there. */
export function setBoundJobsUrl(url: string | null): void {
  jobsUrl = url;
}

/** One request to the bound machine, answered by the reply of type `last`; null with no machine bound. */
export async function askBoundMachine(
  body: Record<string, unknown> & { type: string },
  last: string,
): Promise<Record<string, unknown> | null> {
  const url = jobsUrl;
  if (!url) return null;
  const ws = new WebSocket(url);
  ws.on("error", () => {});
  try {
    return await requestJob(ws, body, (r) => r.type === last);
  } finally {
    ws.close();
  }
}
