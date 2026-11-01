// ServerPrompt.tsx — the first-launch question on a machine with no server saved: connect to one, by its address,
// or stay offline. "Remind me next time" comes ticked; unticked, only the settings connect from then on.
// A server's page never asks: it is the server. See ../../docs/localApp.md.

import { Button } from "@frediverse/ui/button";
import { Checkbox } from "@frediverse/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Cloud } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { normalizeServer } from "@studio/web-protocol/pairing";
import { STUDIO_ORIGIN } from "@studio/web-protocol/services";
import { useEffect, useState } from "react";
import { useLocalApp } from "../localApp";
import { m } from "../paraglide/messages.js";
import { useSavedServers } from "../settings/savedServers";
import { AccountStatusNote } from "../tabs/AccountStatusNote";
import { inAndroidApp } from "../tabs/bridge";
import { connectServer } from "../tabs/connectServer";
import { promptAnswered, promptDue } from "./promptDue";

export function ServerPrompt() {
  const local = useLocalApp();
  if (!local && !inAndroidApp()) return null;
  return <Prompt />;
}

function Prompt() {
  const { servers } = useSavedServers();
  const [open, setOpen] = useState(false);
  const [server, setServer] = useState(
    STUDIO_ORIGIN.replace(/^https:\/\//, ""),
  );
  const [remind, setRemind] = useState(true);
  const [busy, setBusy] = useState(false);
  // Decided once, on the first answer: a server added meanwhile does not reopen or close it.
  const [decided, setDecided] = useState(false);
  useEffect(() => {
    if (servers === null || decided) return;
    setDecided(true);
    if (!promptDue(servers.length)) return;
    setOpen(true);
  }, [servers, decided]);

  const origin = normalizeServer(server);
  const close = () => {
    promptAnswered(remind);
    setOpen(false);
  };
  const connect = async () => {
    if (!origin) return;
    promptAnswered(remind);
    setBusy(true);
    const paired = await connectServer(origin);
    setBusy(false);
    // Paired, the page reads again with that server's workspaces; not, the note below says why.
    if (paired) location.reload();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{m["serverPrompt.title"]()}</DialogTitle>
          <DialogDescription>{m["serverPrompt.body"]()}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <Input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="app.k7.rocks"
            aria-label={m["serverPrompt.address"]()}
            aria-invalid={!origin && !!server.trim()}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            inputMode="url"
          />
          <p className="min-h-4 text-xs">
            {/* An empty field is not yet a mistake: Connect stays greyed meanwhile. */}
            {!origin && server.trim() ? (
              <span className="text-destructive">
                {m["account.status.badServer"]({ server: server.trim() })}
              </span>
            ) : (
              <span className="font-mono text-muted-foreground">{origin}</span>
            )}
          </p>
          <label
            htmlFor="server-prompt-remind"
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <Checkbox
              id="server-prompt-remind"
              checked={remind}
              onCheckedChange={(c) => setRemind(c === true)}
            />
            {m["serverPrompt.remind"]()}
          </label>
          <div className="flex items-center gap-2 text-muted-foreground text-xs empty:hidden">
            <AccountStatusNote />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={close}
            >
              {m["serverPrompt.offline"]()}
            </Button>
            <Button type="submit" disabled={!origin || busy}>
              <Cloud className="mr-1 h-4 w-4" />
              {m["serverPrompt.connect"]()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
