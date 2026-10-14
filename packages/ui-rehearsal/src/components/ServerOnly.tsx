// ServerOnly.tsx — releases and pages live on the server alone: what they draw is drawn only once the
// server can be reached, and otherwise the sentence saying why not. On the server itself, always.
// See ../../../rehearsal-server/docs/publications.md.

import { Button } from "@frediverse/ui/button";
import { CloudOff } from "@frediverse/ui/icons";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { m } from "../paraglide/messages.js";
import type { PublicationsStatus } from "../types";

/** Why the server cannot be reached, as a sentence. */
function why(st: PublicationsStatus): string {
  const server = st.server ? new URL(st.server).host : "";
  if (st.reason === "unpaired") return m["publications.unavailable.unpaired"]();
  if (st.reason === "repair")
    return m["publications.unavailable.repair"]({ server });
  return m["publications.unavailable.unreachable"]({ server });
}

export function ServerOnly({
  children,
  onAvailable,
}: {
  children: ReactNode;
  /** Called each time the server is found reachable, to load what was refused before. */
  onAvailable?: () => void;
}) {
  const [status, setStatus] = useState<PublicationsStatus | null>(null);

  const check = useCallback(async () => {
    setStatus(null);
    const st = await api
      .publicationsStatus()
      .catch(
        (): PublicationsStatus => ({ available: false, reason: "unreachable" }),
      );
    setStatus(st);
    if (st.available) onAvailable?.();
  }, [onAvailable]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: asked once per mount, not per new callback
  useEffect(() => {
    void check();
  }, []);

  if (!status) return <p className="muted">{m["common.loading"]()}</p>;
  if (status.available) return <>{children}</>;
  return (
    <div className="server-only-notice">
      <CloudOff className="size-5 shrink-0" />
      <p className="muted">{why(status)}</p>
      <Button variant="outline" size="sm" onClick={() => void check()}>
        {m["publications.retry"]()}
      </Button>
    </div>
  );
}
