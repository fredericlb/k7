// boundMachine.ts — the jobs path of the engine machine this account is bound to, as the hub last
// said: where separations run, set lists land, the Logs panel reads and the machine's own settings
// live. Its own module because `hosted.ts` refuses to load without a hub secret, and a route must be
// importable without one.

import { requestJobAt } from "@studio/engine-tunnel/jobs-client";

let jobsUrl: string | null = null;
let engine: { id: string; name: string } | null = null;

/** The bound machine's jobs path, or null while no engine is bound. */
export function boundJobsUrl(): string | null {
  return jobsUrl;
}

/** Which engine is bound — its registry id and a name to show — or null; what an undo's audio is kept by. */
export function boundEngine(): { id: string; name: string } | null {
  return jobsUrl ? engine : null;
}

/** Set by the hub's binding route, and only there. */
export function setBoundJobsUrl(
  url: string | null,
  which: { id: string; name: string } | null = null,
): void {
  jobsUrl = url;
  engine = url ? which : null;
}

/** One request to the bound machine, answered by the reply of type `last`; null with no machine bound. */
export async function askBoundMachine(
  body: Record<string, unknown> & { type: string },
  last: string,
): Promise<Record<string, unknown> | null> {
  const url = jobsUrl;
  if (!url) return null;
  return await requestJobAt(url, body, (r) => r.type === last);
}
