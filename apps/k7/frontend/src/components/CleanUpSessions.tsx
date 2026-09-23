// CleanUpSessions.tsx — the settings card that deletes empty sessions in one go.
// "Empty" is no moments and recorded over 24h ago: a fresh take may not have been tagged yet.

import { Button } from "@frediverse/ui/button";
import { BrushCleaning } from "@frediverse/ui/icons";
import type { Session } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

interface Props {
  sessions: Session[];
  onClean: (ids: string[]) => Promise<void>;
}

export function CleanUpSessions({ sessions, onClean }: Props) {
  const stale = sessions.filter(
    (s) =>
      s.annotations.length === 0 &&
      Date.now() - new Date(s.createdAt).getTime() >= DAY_MS,
  );
  const n = stale.length;

  const clean = async () => {
    if (n === 0) return;
    if (
      !confirm(
        `Delete ${n} empty session${n === 1 ? "" : "s"} with no moments, ` +
          `recorded over 24h ago?`,
      )
    )
      return;
    await onClean(stale.map((s) => s.id));
  };

  return (
    <>
      <div className="settings-title muted small">Recordings</div>
      <p className="muted small">
        Delete the sessions that have no moments and were recorded over 24h ago,
        with their recordings.
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={clean}
        disabled={n === 0}
        title="Delete empty sessions (no moments) recorded over 24h ago"
      >
        <BrushCleaning className="size-4" /> Clean up {n > 0 ? `${n} ` : ""}
        empty session{n === 1 ? "" : "s"}
      </Button>
    </>
  );
}
