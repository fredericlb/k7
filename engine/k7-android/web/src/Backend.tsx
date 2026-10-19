// Backend.tsx — the phone's own k7 while it is not up yet (BackendHost.kt): a first run unpacks for a few seconds,
// and a start that failed says why with a Retry, since no app view can open on a studio that never answered.
// The wait is the startup splash, full screen over the tray, on the colour the native launch screen drew (k7's docs/icons.md).

import { Button } from "@frediverse/ui/button";
import splash from "../../../../apps/k7/frontend/icon/k7-splash.svg";
import { AppViews, type BackendStatus } from "./native";

export function BackendPanel({ status }: { status: BackendStatus }) {
  if (status.state === "ready") return null;
  if (status.state === "failed") {
    return (
      <section className="mx-auto flex w-full max-w-xl flex-col gap-3 px-4 pt-10">
        <h1 className="text-lg font-medium">k7 could not start</h1>
        <p className="text-sm text-destructive">{status.message}</p>
        <Button
          className="self-start"
          onClick={() => AppViews.restartBackend()}
        >
          Retry
        </Button>
      </section>
    );
  }
  const pct =
    status.step === "unpacking" && status.progress != null
      ? Math.round(status.progress * 100)
      : null;
  return (
    <section
      role="status"
      aria-label="Starting k7"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[#07031F] px-8"
    >
      <img src={splash} alt="" className="w-[min(70vw,28rem)]" />
      <div className="flex w-full max-w-xs flex-col items-center gap-2">
        <p className="text-center text-sm text-muted-foreground">
          {status.step === "launching"
            ? "launching"
            : status.step === "unpacking"
              ? `unpacking ${pct ?? 0}% — only on the first run after an install`
              : "preparing"}
        </p>
        {pct != null ? (
          <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
