// ConsolidateDialog.tsx — a local instance's moment sent to the account's ACTIVE server: the dialog names that server
// and whether it answers, and Send waits for one that does and does not hold the moment yet. ../../docs/recordings.md.

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
import { type ReactNode, useEffect, useState } from "react";
import { api } from "../api";
import { sendRefusal, serverLabel } from "../consolidation";
import { m } from "../paraglide/messages.js";
import type { ConsolidationServer } from "../types";
import type { ConsolidatedMoment } from "./Consolidation";

export function ConsolidateDialog({
  moment,
  onClose,
  onConfirm,
}: {
  moment: ConsolidatedMoment;
  onClose: () => void;
  onConfirm: (server: ConsolidationServer) => void;
}) {
  // Undefined while asking; null when the account has no active server.
  const [server, setServer] = useState<ConsolidationServer | null>();
  const [error, setError] = useState<string | null>(null);

  // Asked on mounting, which is every opening: whether the server answers is what changes between two.
  useEffect(() => {
    let alive = true;
    api
      .consolidationServers()
      .then((s) => alive && setServer(s.server))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const refused =
    server === undefined ? null : sendRefusal(server, moment.consolidations);

  let body: ReactNode;
  if (error) body = <p className="error small">{error}</p>;
  else if (server === undefined)
    body = (
      <p className="muted">
        <Loader2 className="size-4 animate-spin" /> {m["common.loading"]()}
      </p>
    );
  else if (!server)
    body = <p className="muted">{m["moment.consolidate.noLink"]()}</p>;
  else
    body = (
      <>
        <p>
          {serverLabel(server)} —{" "}
          {refused === "already"
            ? m["moment.consolidate.already"]()
            : server.online
              ? m["moment.consolidate.online"]()
              : m["moment.consolidate.offline"]()}
        </p>
        {refused === "offline" && (
          <p className="error small">
            {m["moment.consolidate.away"]({ server: serverLabel(server) })}
          </p>
        )}
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
            disabled={!server || refused !== null}
            onClick={() => server && onConfirm(server)}
          >
            <CloudUpload className="size-4" /> {m["moment.consolidate.send"]()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
