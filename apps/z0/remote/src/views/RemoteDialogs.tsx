// The remote's three modal steps: confirm a penalty, type a score, pick the multi-track to strike.
// Each is open while its flag in the shared bag is set; closing one clears the player it was about.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Input } from "@frediverse/ui/input";
import { cn } from "@frediverse/ui/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@frediverse/ui/sheet";
import { m } from "../paraglide/messages.js";
import { PUNISH_AMOUNT } from "../remote/state";
import type { Remote } from "../remote/useRemote";

export function RemoteDialogs({ r }: { r: Remote }) {
  return (
    <>
      <PunishDialog r={r} />
      <ScoreEditorDialog r={r} />
      <TrackPickerSheet r={r} />
    </>
  );
}

function PunishDialog({ r }: { r: Remote }) {
  const { g, a, render } = r;
  const close = () => {
    g.punishConfirmOpen = false;
    g.punishTarget = null;
    render();
  };
  const name = g.punishTarget?.toUpperCase() ?? "";
  return (
    <Dialog open={g.punishConfirmOpen} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            {m["remote.punishConfirm"]({ name })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" className="flex-1" onClick={close}>
            {m["remote.cancel"]()}
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            onClick={() => {
              const target = g.punishTarget;
              close();
              if (target) {
                const current =
                  g.players.find((pl) => pl.name === target)?.score ?? 0;
                void a.setPlayerScore(target, current - PUNISH_AMOUNT);
              }
            }}
          >
            {m["remote.confirm"]()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScoreEditorDialog({ r }: { r: Remote }) {
  const { g, a, render } = r;
  const close = () => {
    g.scoreEditorOpen = false;
    g.scoreEditorPlayer = null;
    render();
  };
  const apply = () => {
    const player = g.scoreEditorPlayer;
    close();
    if (player)
      void a.setPlayerScore(
        player,
        Math.round(Number(g.scoreEditorValue) || 0),
      );
  };
  return (
    <Dialog open={g.scoreEditorOpen} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-xs" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-center">
            {g.scoreEditorPlayer?.toUpperCase()}
          </DialogTitle>
        </DialogHeader>
        <Input
          type="number"
          inputMode="numeric"
          aria-label={m["remote.editScore"]()}
          className="h-12 text-center text-xl tabular-nums"
          value={g.scoreEditorValue}
          onChange={(e) => {
            g.scoreEditorValue = Number(e.target.value);
            render();
          }}
          onKeyUp={(e) => {
            if (e.key === "Enter") apply();
          }}
        />
        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" className="flex-1" onClick={close}>
            {m["remote.cancel"]()}
          </Button>
          <Button className="flex-1" onClick={apply}>
            {m["remote.apply"]()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// A bottom sheet, since the host picks with a thumb; tapping outside does NOT cancel, as before.
function TrackPickerSheet({ r }: { r: Remote }) {
  const { g, a, render } = r;
  const cancel = () => {
    g.showTrackPicker = false;
    g.pendingScorePlayer = null;
    render();
  };
  return (
    <Sheet open={g.showTrackPicker} onOpenChange={(o) => !o && cancel()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[90dvh] overflow-y-auto pb-4"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <SheetHeader className="text-center">
          <SheetTitle className="text-lg text-amber">
            {g.pendingScorePlayer
              ? `${m["remote.score"]()}: ${g.pendingScorePlayer.toUpperCase()}`
              : m["remote.noWinner"]()}
          </SheetTitle>
          <SheetDescription>
            {m["remote.selectTrackToRemove"]()}
          </SheetDescription>
        </SheetHeader>
        <div className="mx-auto flex w-full max-w-md flex-col gap-2.5 px-4">
          {g.multiTracks.map((track, idx) => (
            <Button
              // biome-ignore lint/suspicious/noArrayIndexKey: the track index IS its identity on the wire.
              key={idx}
              size="lg"
              variant="outline"
              className={cn("h-14 text-base", track.removed && "line-through")}
              disabled={track.removed}
              onClick={() => void a.pickMultiTrack(idx)}
            >
              {track.title.toUpperCase()}
            </Button>
          ))}
          <Button variant="destructive" className="mt-2" onClick={cancel}>
            {m["remote.cancel"]()}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
