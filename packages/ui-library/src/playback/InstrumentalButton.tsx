// InstrumentalButton.tsx — the bar's switch to a library song's instrumental, and back. A song with
// none asks first, then cuts one: the button greys out with the cut's percent, and the song switches
// to it on its own once it lands — if it is still the one playing (../../docs/miniPlayer.md).

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Loader2, MicOff } from "@frediverse/ui/icons";
import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { useLabels } from "../host";
import {
  INSTRUMENTAL_VERSION,
  instrumentals,
  masterOf,
  UNKNOWN,
} from "./instrumental";
import { usePlayback } from "./PlaybackProvider";
import { PositionContext } from "./position";

export function InstrumentalButton() {
  const labels = useLabels();
  const l = labels.playback;
  const { now, start } = usePlayback();
  const positions = useContext(PositionContext);
  const [asking, setAsking] = useState(false);
  const master = now ? masterOf(now.entry) : null;
  const state = useSyncExternalStore(instrumentals.subscribe, () =>
    master ? instrumentals.get(master) : UNKNOWN,
  );

  // Asked once per song: the store remembers, whichever song the bar shows next.
  useEffect(() => {
    if (now && master) void instrumentals.check(now.entry);
  }, [now, master]);

  /** Play the same song from `path`, where the transport is now — the variant tabs' switch. */
  const playFrom = (path: string, version?: string) => {
    if (!now) return;
    start(
      { entry: now.entry, path, target: now.target, version },
      positions?.get().position ?? 0,
    );
  };

  // A cut asked for here lands: the song switches to it — only if it is still this song playing its master.
  useEffect(() => {
    if (!now || !master || state.kind !== "ready") return;
    if (now.version || !instrumentals.takeLanded(master)) return;
    playFrom(state.path, INSTRUMENTAL_VERSION);
  });

  // Only a library song has a master to cut, and a folder to keep the cut in.
  if (!now || !master) return null;

  const onInstrumental = now.version === INSTRUMENTAL_VERSION;
  const making = state.kind === "making";
  const title = onInstrumental
    ? l.instrumentalBack
    : state.kind === "ready"
      ? l.instrumental
      : making
        ? l.instrumentalMaking
        : state.kind === "failed"
          ? state.noEngine
            ? l.instrumentalNoEngine
            : l.instrumentalFailed(state.error)
          : l.instrumentalMake;

  const press = () => {
    if (onInstrumental) return playFrom(master);
    if (state.kind === "ready")
      return playFrom(state.path, INSTRUMENTAL_VERSION);
    setAsking(true);
  };

  return (
    <>
      <Button
        variant={onInstrumental ? "secondary" : "ghost"}
        size="sm"
        className="h-7 shrink-0 gap-1 px-2 tabular-nums"
        aria-pressed={onInstrumental}
        aria-label={title}
        title={title}
        disabled={making || state.kind === "unknown"}
        onClick={press}
      >
        {making && state.percent === null ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <MicOff className="h-3.5 w-3.5" />
        )}
        {/* The cut's progress, said plainly while it runs. */}
        {making && state.percent !== null && (
          <span className="text-xs">{Math.round(state.percent)}%</span>
        )}
      </Button>

      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{l.instrumentalMake}</DialogTitle>
            <DialogDescription>
              {l.instrumentalAsk(now.entry.name)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              {labels.common.cancel}
            </Button>
            <Button
              onClick={() => {
                setAsking(false);
                void instrumentals.make(now.entry);
              }}
            >
              {l.instrumentalConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
