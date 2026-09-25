// boundMachine.ts — the jobs path of the engine machine this account is bound to, as the hub last
// said: where separations run, set lists land and the Logs panel reads. Its own module because
// `hosted.ts` refuses to load without a hub secret, and a route must be importable without one.

let jobsUrl: string | null = null;

/** The bound machine's jobs path, or null while no engine is bound. */
export function boundJobsUrl(): string | null {
  return jobsUrl;
}

/** Set by the hub's binding route, and only there. */
export function setBoundJobsUrl(url: string | null): void {
  jobsUrl = url;
}
