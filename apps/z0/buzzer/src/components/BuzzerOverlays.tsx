// What stands between a player and the buzzer: the unlock tap, then the wait for a game to join.
// Both render OUTSIDE the buzzing page: a portal still bubbles React events, and a tap here must never buzz.

import { Alert, AlertTitle } from "@frediverse/ui/alert";
import { Button } from "@frediverse/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@frediverse/ui/dialog";
import { Loader2, LockOpen } from "@frediverse/ui/icons";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@frediverse/ui/sheet";

// The wake lock needs a user gesture, so any dismissal — a tap outside, Escape, the button — unlocks.
export function UnlockDialog({
  open,
  label,
  onUnlock,
}: {
  open: boolean;
  label: string;
  onUnlock: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onUnlock();
      }}
    >
      <DialogContent showCloseButton={false} aria-describedby={undefined}>
        <DialogTitle className="sr-only">{label}</DialogTitle>
        <Button
          size="lg"
          className="h-auto w-full flex-col gap-4 py-10 text-base"
          onClick={onUnlock}
        >
          <LockOpen className="size-16" />
          {label}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// Non-modal, so the account badge stays reachable: a player waiting on the wrong account can still log out.
export function WaitingSheet({
  open,
  label,
  error,
}: {
  open: boolean;
  label: string;
  error: string;
}) {
  return (
    <Sheet open={open} modal={false}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        showOverlay={false}
        aria-describedby={undefined}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="rounded-t-xl pb-6"
      >
        <SheetHeader className="flex-row items-center justify-center gap-3">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <SheetTitle className="tracking-widest">{label}</SheetTitle>
        </SheetHeader>
        {error && (
          <Alert variant="destructive" className="mx-auto w-auto">
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        )}
      </SheetContent>
    </Sheet>
  );
}
