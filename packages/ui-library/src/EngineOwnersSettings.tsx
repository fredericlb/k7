// EngineOwnersSettings.tsx — the settings screen's card for ADMINS: every engine an account of this
// server owns, whoever's it is, and the way to reset one. Anyone else is answered 403 and gets no card.
// The Engines card above lists only what this account may use. See ../docs/settings.md.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { Loader2, RefreshCw, Server } from "@frediverse/ui/icons";
import { useCallback, useEffect, useState } from "react";
import { type EngineOwnerRecord, engineOwners } from "./engineShares";
import { useLabels } from "./host";

function OwnerRow({
  o,
  onReset,
}: {
  o: EngineOwnerRecord;
  onReset: () => void;
}) {
  const l = useLabels().engines;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      await engineOwners.reset(o.id);
      onReset();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const shared = o.everyone
    ? l.shareEveryone
    : o.shared.length > 0
      ? l.sharedWith(o.shared.length)
      : null;
  return (
    <li className="flex items-start gap-3 rounded-md border px-3 py-2">
      <Server className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{o.hostname || "—"}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {o.id.slice(0, 8)}
          </span>
          {!o.online && <Badge variant="amber">{l.offline}</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">
          {l.ownedBy(o.owner)}
          {shared && ` · ${shared}`}
          {` · ${l.since(new Date(o.since).toLocaleDateString())}`}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      {/* Two clicks, inline, as the owner's own give-up: nobody owns it until its machine beats again. */}
      <Button
        variant={confirming ? "destructive" : "ghost"}
        size="sm"
        disabled={busy}
        onClick={() => (confirming ? void reset() : setConfirming(true))}
      >
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {confirming ? l.resetConfirm : l.reset}
      </Button>
    </li>
  );
}

export function EngineOwnersSettings() {
  const l = useLabels().engines;
  const [owners, setOwners] = useState<EngineOwnerRecord[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const look = useCallback(async () => {
    setBusy(true);
    try {
      setOwners(await engineOwners.list());
      setError(null);
    } catch (e) {
      if ((e as Error & { status?: number }).status === 403) setDenied(true);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void look();
  }, [look]);

  if (denied) return null;
  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{l.ownersTitle}</h3>
          <p className="text-xs text-muted-foreground">{l.ownersHint}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void look()}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {l.refresh}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {owners === null ? (
        !error && <p className="text-sm text-muted-foreground">{l.looking}</p>
      ) : owners.length === 0 ? (
        <p className="text-sm text-muted-foreground">{l.ownersNone}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {owners.map((o) => (
            <OwnerRow key={o.id} o={o} onReset={() => void look()} />
          ))}
        </ul>
      )}
    </Card>
  );
}
