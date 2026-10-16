// EngineLostStrip.tsx — the strip under the header that says the engine link is down, once it has
// stayed down past a blip, with a Retry that dials at once instead of waiting out the backoff.
// The one thing a reader would get wrong: a dismissal lasts one outage, not the session (docs/shell.md).

import { Button } from "@frediverse/ui/button";
import { Unplug, X } from "@frediverse/ui/icons";
import { useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";

/** How long the link must stay down before the strip shows — a reconnect inside it is a blip. */
const ENGINE_LOST_DELAY_MS = 2000;

export function EngineLostStrip({
  connected,
  onRetry,
}: {
  connected: boolean;
  /** Dial again now; absent when the host has no way to. */
  onRetry?: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    // A reconnect clears both, so the next outage is announced again.
    if (connected) {
      setShown(false);
      setDismissed(false);
      return;
    }
    const t = setTimeout(() => setShown(true), ENGINE_LOST_DELAY_MS);
    return () => clearTimeout(t);
  }, [connected]);
  if (connected || !shown || dismissed) return null;
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-destructive/40 border-b bg-destructive/10 px-3 py-1 text-destructive text-xs"
    >
      <Unplug className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{m["engine.lostStrip"]()}</span>
      {onRetry && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs"
          onClick={onRetry}
        >
          {m["engine.retryNow"]()}
        </Button>
      )}
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6"
        onClick={() => setDismissed(true)}
        title={m["common.dismiss"]()}
        aria-label={m["common.dismiss"]()}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
