// ServerDialog.tsx — the popin a desktop or phone app asks the k7 server through, before its sign-in opens the browser.
// The address names where the account SYNCS; the sign-in itself still goes through the app's own provider.
// See apps/k7-standalone/docs/signIn.md and engine/k7-runtime/docs/android.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { LogIn } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { normalizeServer } from "@studio/web-protocol/pairing";
import { useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";

export function ServerDialog({
  open,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** The last server chosen, shown without its scheme. */
  initial: string;
  onClose: () => void;
  /** Called with the normalized origin. */
  onSubmit: (server: string) => void;
}) {
  const [server, setServer] = useState("");
  // Prefilled afresh at each opening, so a cancelled edit does not linger.
  useEffect(() => {
    if (open) setServer(initial.replace(/^https:\/\//, ""));
  }, [open, initial]);
  const origin = normalizeServer(server);
  const submit = () => {
    if (origin) onSubmit(origin);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{m["account.serverTitle"]()}</DialogTitle>
          <DialogDescription>{m["account.serverHint"]()}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            autoFocus
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="app.k7.rocks"
            aria-label={m["account.serverLabel"]()}
            aria-invalid={!origin && !!server.trim()}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            inputMode="url"
          />
          <p className="min-h-4 text-xs">
            {/* An empty field is not yet a mistake: Sign in stays greyed meanwhile. */}
            {!origin && server.trim() ? (
              <span className="text-destructive">
                {m["account.status.badServer"]({ server: server.trim() })}
              </span>
            ) : (
              <span className="font-mono text-muted-foreground">{origin}</span>
            )}
          </p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              {m["common.cancel"]()}
            </Button>
            <Button type="submit" disabled={!origin}>
              <LogIn className="mr-1 h-4 w-4" />
              {m["auth.signIn"]()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
