// CleanUpSessions.tsx — the settings card that deletes empty sessions in one go.
// "Empty" is no moments and recorded over 24h ago: a fresh take may not have been tagged yet.

import { Button } from "@frediverse/ui/button";
import { BrushCleaning } from "@frediverse/ui/icons";
import { confirmLoss } from "../confirm";
import { isOne } from "../i18n";
import { m } from "../paraglide/messages.js";
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
    const ask = isOne(n)
      ? m["cleanup.confirm.one"]({ n })
      : m["cleanup.confirm.other"]({ n });
    if (!(await confirmLoss(ask))) return;
    await onClean(stale.map((s) => s.id));
  };

  return (
    <>
      <div className="settings-title muted small">{m["nav.recordings"]()}</div>
      <p className="muted small">{m["cleanup.help"]()}</p>
      <Button
        variant="outline"
        size="sm"
        onClick={clean}
        disabled={n === 0}
        title={m["cleanup.title"]()}
      >
        <BrushCleaning className="size-4" />{" "}
        {n === 0
          ? m["cleanup.none"]()
          : isOne(n)
            ? m["cleanup.button.one"]({ n })
            : m["cleanup.button.other"]({ n })}
      </Button>
    </>
  );
}
