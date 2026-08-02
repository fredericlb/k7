// UploadProgress.tsx — a thin non-intrusive progress bar for file uploads.
// Shows at the bottom of the file tree sidebar while uploads are in progress.
// Displays file name, byte count, and an animated progress bar.

import { cn } from "@frediverse/ui/lib/utils";

export interface UploadProgressProps {
  /** Current file being uploaded (null when idle). */
  fileName: string | null;
  /** Bytes loaded so far. */
  loaded: number;
  /** Total bytes across all files in this batch. */
  total: number;
  /** Number of files completed so far (for multi-file batches). */
  done: number;
  /** Total number of files in the batch. */
  count: number;
  /** Whether an upload is currently active. */
  active: boolean;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadProgress({
  fileName,
  loaded,
  total,
  done,
  count,
  active,
}: UploadProgressProps) {
  if (!active) return null;

  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  const label =
    count > 1
      ? `${fileName}  (${done + 1}/${count})  ${formatBytes(loaded)} / ${formatBytes(total)}`
      : `${fileName}  ${formatBytes(loaded)} / ${formatBytes(total)}`;

  return (
    <div className="border-t border-border bg-card/60 px-3 py-1.5">
      <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="truncate">{label}</span>
        <span className="ml-2 shrink-0 tabular-nums">{pct}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-150 ease-out",
            "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
