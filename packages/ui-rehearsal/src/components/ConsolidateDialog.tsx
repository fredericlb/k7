// ConsolidateDialog.tsx — which server a local instance's moment is consolidated on: the account's links,
// main first, each said online or not, the first online one still open preselected. ../../docs/recordings.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { CloudUpload, Loader2 } from "@frediverse/ui/icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frediverse/ui/select";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "../api";
import { choosable, preselectServer, serverLabel } from "../consolidation";
import { m } from "../paraglide/messages.js";
import type { ConsolidationServer } from "../types";
import type { ConsolidatedMoment } from "./Consolidation";

/** One server's line in the dropdown: its label, and whether it answers or already holds the moment. */
function stateOf(s: ConsolidationServer, done: Set<string>): string {
  if (done.has(s.id)) return m["moment.consolidate.already"]();
  return s.online
    ? m["moment.consolidate.online"]()
    : m["moment.consolidate.offline"]();
}

export function ConsolidateDialog({
  moment,
  onClose,
  onConfirm,
}: {
  moment: ConsolidatedMoment;
  onClose: () => void;
  onConfirm: (server: ConsolidationServer) => void;
}) {
  const [servers, setServers] = useState<ConsolidationServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  // Asked afresh on every opening: which servers answer is what changes between two.
  useEffect(() => {
    let alive = true;
    api
      .consolidationServers()
      .then((s) => {
        if (!alive) return;
        setServers(s.servers);
        setChosen(preselectServer(choosable(s.servers, moment.consolidations)));
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [moment]);

  const done = new Set((moment.consolidations ?? []).map((c) => c.link));
  const open = servers ? choosable(servers, moment.consolidations) : [];
  const target = servers?.find((s) => s.id === chosen) ?? null;

  let body: ReactNode;
  if (error) body = <p className="error small">{error}</p>;
  else if (!servers)
    body = (
      <p className="muted">
        <Loader2 className="size-4 animate-spin" /> {m["common.loading"]()}
      </p>
    );
  else if (!servers.length)
    body = <p className="muted">{m["moment.consolidate.noLink"]()}</p>;
  else
    body = (
      <>
        <Select value={chosen ?? undefined} onValueChange={setChosen}>
          <SelectTrigger aria-label={m["moment.consolidate.server"]()}>
            <SelectValue placeholder={m["moment.consolidate.choose"]()} />
          </SelectTrigger>
          <SelectContent className="rehearsal-root">
            {servers.map((s) => (
              <SelectItem
                key={s.id}
                value={s.id}
                disabled={done.has(s.id) || !s.online}
              >
                {serverLabel(s)} — {stateOf(s, done)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!open.length ? (
          <p className="muted small">{m["moment.consolidate.everywhere"]()}</p>
        ) : !open.some((s) => s.online) ? (
          <p className="error small">{m["moment.consolidate.noneOnline"]()}</p>
        ) : null}
      </>
    );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rehearsal-root max-w-md">
        <DialogHeader>
          <DialogTitle>{m["moment.consolidate.title"]()}</DialogTitle>
          <DialogDescription>{m["moment.consolidate.why"]()}</DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {m["common.cancel"]()}
          </Button>
          <Button
            disabled={!target || !target.online || done.has(target.id)}
            onClick={() => target && onConfirm(target)}
          >
            <CloudUpload className="size-4" /> {m["moment.consolidate.send"]()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
