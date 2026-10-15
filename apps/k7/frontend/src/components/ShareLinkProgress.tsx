// ShareLinkProgress.tsx — the share panel's bar while a link is being made: VST tracks rendered, the checkpoint
// named, the shared version uploaded. The link exists only at the end, so this is all the author has meanwhile.
// See packages/file-service/docs/share.md.

import type { ShareProgress } from "@studio/web-protocol";
import { shareProgressLine, shareProgressPct } from "../shareProgress";

export function ShareLinkProgress({ progress }: { progress: ShareProgress }) {
  if (progress.step === "done") return null;
  const failed = progress.step === "failed";
  const pct = shareProgressPct(progress);
  return (
    <div className="flex flex-col gap-1 px-2 py-1.5 text-xs">
      <span
        className={failed ? "text-destructive" : "text-muted-foreground"}
        aria-live="polite"
      >
        {shareProgressLine(progress)}
      </span>
      {failed ? null : (
        <span
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-1 w-full overflow-hidden rounded-full bg-muted"
        >
          <span
            className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </span>
      )}
    </div>
  );
}
