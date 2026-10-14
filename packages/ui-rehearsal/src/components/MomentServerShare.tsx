// MomentServerShare.tsx — on a machine paired with a server: which moments the server holds a copy of, and
// the sharing of one. A session never leaves the machine, so nothing here is about sessions.
// Nothing at all on an unpaired machine or on the server itself. See ../../../rehearsal-server/docs/momentShare.md.

import { Button } from "@frediverse/ui/button";
import {
  CloudCheck,
  CloudUpload,
  HardDrive,
  Loader2,
} from "@frediverse/ui/icons";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { m } from "../paraglide/messages.js";
import type { MomentPlacement } from "../types";

export type MomentState = "synced" | "local";

const hostOf = (p: MomentPlacement | null): string =>
  p?.server ? new URL(p.server).host : "";

/** The moments' placement, asked again whenever `trigger` changes; null when there is nothing to say. */
export function useMomentShare(active: boolean, trigger: unknown) {
  const [placement, setPlacement] = useState<MomentPlacement | null>(null);

  const reload = useCallback(async () => {
    try {
      const p = await api.momentPlacement();
      setPlacement(p.paired ? p : null);
    } catch {
      // A server that is away says nothing about what it holds: no icons rather than wrong ones.
      setPlacement(null);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `trigger` is when the moments changed here
  useEffect(() => {
    if (active) void reload();
  }, [active, trigger, reload]);

  const shared = new Set(placement?.shared ?? []);
  return {
    placement,
    host: hostOf(placement),
    /** One moment's state, or null when the machine is not paired. */
    stateOf: (id: string): MomentState | null =>
      placement ? (shared.has(id) ? "synced" : "local") : null,
    share: async (id: string) => {
      await api.shareMoment(id);
      await reload();
    },
  };
}

/** One icon: shared with the server, or on this machine only. */
export function MomentStateIcon({
  state,
  host,
}: {
  state: MomentState | null;
  host: string;
}) {
  if (!state) return null;
  const said =
    state === "synced"
      ? m["moment.share.synced"]({ server: host })
      : m["moment.share.local"]();
  const Icon = state === "synced" ? CloudCheck : HardDrive;
  return (
    <span
      title={said}
      role="img"
      aria-label={said}
      className={`moment-placement${state === "synced" ? " synced" : ""}`}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

/** The moment page's button: share it, or share it again over the server's copy. */
export function ShareMomentButton({
  state,
  host,
  onShare,
}: {
  state: MomentState | null;
  host: string;
  onShare: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!state) return null;
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        title={
          state === "synced"
            ? m["moment.share.againHint"]({ server: host })
            : undefined
        }
        onClick={() => {
          setBusy(true);
          setError(null);
          onShare()
            .catch((e: Error) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <CloudUpload className="size-4" />
        )}{" "}
        {busy
          ? m["moment.share.sharing"]()
          : state === "synced"
            ? m["moment.share.again"]()
            : m["moment.share.action"]()}
      </Button>
      {error ? <span className="error small">{error}</span> : null}
    </>
  );
}
