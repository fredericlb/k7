// EngineSyncProgress.tsx — the footer's bar while the project's files are copied to the engine's
// machine: the project is sent, and plays, only once they are all there, so nothing is fetched
// mid-set. Counts only what had to be copied. See packages/file-service/docs/engineSync.md.

import type { EngineSyncState } from "@studio/web-protocol";
import { formatBytes } from "./UploadProgress";

/** Whether `s` is a copy still running, as opposed to the report of one that went wrong. */
export const syncRunning = (s: EngineSyncState | null | undefined): boolean =>
  !!s && s.error === undefined && s.failed === undefined;

export function EngineSyncProgress({ sync }: { sync: EngineSyncState }) {
  // A failed copy is EngineSyncFailedDialog's, not a line in the footer.
  if (!syncRunning(sync)) return null;
  const pct =
    sync.bytes > 0
      ? Math.min(100, Math.round((sync.bytesDone / sync.bytes) * 100))
      : 0;
  return (
    <span
      className="flex shrink-0 items-center gap-2 whitespace-nowrap text-amber-500"
      title="copying the project's files to the engine's machine — it plays once they are all there"
    >
      copying to the engine {sync.filesDone}/{sync.files} ·{" "}
      {formatBytes(sync.bytesDone)} / {formatBytes(sync.bytes)}
      <span
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1 w-24 overflow-hidden rounded-full bg-muted"
      >
        <span
          className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}
