// modelDownload.ts — following a model download to its end, for the two places that start one: a
// project node's right-click ("Download model") and a cold chain in the settings. The file service
// runs the download as a job (a model is 166 MB); this polls it and says how far it is.
// See packages/song/docs/moduleAssets.md.

import { trackDownload } from "@studio/http-client/downloads";
import type { ModelDownloadJob } from "@studio/web-protocol";
import { m } from "./paraglide/messages.js";

const POLL_MS = 1000;
const MB = 1024 * 1024;

/** One line for the job as it stands — the status bar's, or the settings'. */
export function describeDownload(j: ModelDownloadJob): string {
  if (j.done) return j.error ?? m["status.modelDownloaded"]({ file: j.file });
  const got = (j.received / MB).toFixed(0);
  if (!j.total) return m["status.modelDownloading"]({ file: j.file, got });
  const pct = Math.floor((j.received / j.total) * 100);
  return m["status.modelDownloadingPct"]({
    file: j.file,
    pct,
    got,
    total: (j.total / MB).toFixed(0),
  });
}

/** Poll until the job is done, reporting each state; answers the final one. A poll that fails ends it as an error rather than spinning. */
export async function followDownload(
  job: ModelDownloadJob,
  poll: (id: string) => Promise<ModelDownloadJob>,
  onUpdate: (j: ModelDownloadJob) => void,
): Promise<ModelDownloadJob> {
  // The sidebar's download manager follows it too (packages/http-client/docs/downloads.md).
  const tracked = trackDownload({
    key: `model:${job.id}`,
    kind: "engine",
    label: job.file,
  });
  const report = (j: ModelDownloadJob) => {
    tracked.progress(j.received, j.total || undefined);
    if (j.done) tracked.end(j.error ?? undefined);
    onUpdate(j);
  };
  let now = job;
  report(now);
  while (!now.done) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      now = await poll(now.id);
    } catch (e) {
      now = { ...now, done: true, error: (e as Error).message };
    }
    report(now);
  }
  return now;
}
