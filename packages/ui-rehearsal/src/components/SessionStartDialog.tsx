// SessionStartDialog.tsx — what a session says while it starts: the source was picked in the New session
// button's menu (this device, or the account's rehearsal chain), so the dialog only says what it opens,
// how far it is, and why it failed. See ../../docs/chainSource.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Loader2 } from "@frediverse/ui/icons";
import { m } from "../paraglide/messages.js";

interface Props {
  open: boolean;
  /** Where the start stands, in words. */
  status: string;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}

export function SessionStartDialog({
  open,
  status,
  error,
  onRetry,
  onClose,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rehearsal-root sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{m["rec.newSession"]()}</DialogTitle>
          <DialogDescription>
            {error ? (
              <span className="error">{error}</span>
            ) : (
              <span>
                <Loader2 className="inline size-4 animate-spin" /> {status}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="source-choices">
          {error && <Button onClick={onRetry}>{m["source.retry"]()}</Button>}
          <Button variant="ghost" onClick={onClose}>
            {m["chain.cancel"]()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
