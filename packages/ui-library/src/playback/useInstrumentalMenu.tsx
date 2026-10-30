// useInstrumentalMenu.tsx — the switch to a library song's instrumental, and back, as an item of the
// bar's play-button menu. A song with none asks first, then cuts one: the item greys out with the cut's
// percent, and the song switches to it on its own once it lands — if it is still the one playing.
// The dialog lives outside the menu, which unmounts on select (../../docs/miniPlayer.md).

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { DropdownMenuItem } from "@frediverse/ui/dropdown-menu";
import { Loader2 } from "@frediverse/ui/icons";
import { Switch } from "@frediverse/ui/switch";
import {
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useLabels } from "../host";
import {
  INSTRUMENTAL_VERSION,
  instrumentals,
  masterOf,
  UNKNOWN,
} from "./instrumental";
import { usePlayback } from "./PlaybackProvider";
import { PositionContext } from "./position";

/** The menu's item (undefined when the song has no master to cut) and the dialog asking to make one. */
export function useInstrumentalMenu(): {
  item: ReactNode | undefined;
  dialog: ReactNode;
} {
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
    start({ entry: now.entry, path, version }, positions?.get().position ?? 0);
  };

  // A cut asked for here lands: the song switches to it — only if it is still this song playing its master.
  useEffect(() => {
    if (!now || !master || state.kind !== "ready") return;
    if (now.version || !instrumentals.takeLanded(master)) return;
    playFrom(state.path, INSTRUMENTAL_VERSION);
  });

  // Only a library song has a master to cut, and a folder to keep the cut in.
  if (!now || !master) return { item: undefined, dialog: null };

  const on = now.version === INSTRUMENTAL_VERSION;
  const making = state.kind === "making";
  // Under the switch, what it would do when that is not plain: none yet, one being cut, a failure.
  const hint = on
    ? null
    : making
      ? `${l.instrumentalMaking}${state.percent !== null ? ` ${Math.round(state.percent)}%` : ""}`
      : state.kind === "failed"
        ? state.noEngine
          ? l.instrumentalNoEngine
          : l.instrumentalFailed(state.error)
        : state.kind === "absent"
          ? l.instrumentalMake
          : null;

  const toggle = () => {
    if (on) return playFrom(master);
    if (state.kind === "ready")
      return playFrom(state.path, INSTRUMENTAL_VERSION);
    setAsking(true);
  };

  const item = (
    <DropdownMenuItem
      disabled={making || state.kind === "unknown"}
      onSelect={toggle}
      className="items-start gap-2"
    >
      {making && state.percent === null ? (
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
      ) : (
        // Drawn, not pressed: the whole row is the switch.
        <Switch
          checked={on}
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none mt-0.5"
        />
      )}
      <span className="min-w-0 flex-1">
        {l.instrumentalToggle}
        {hint ? (
          <span className="block text-muted-foreground text-xs">{hint}</span>
        ) : null}
      </span>
    </DropdownMenuItem>
  );

  const dialog = (
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
  );

  return { item, dialog };
}
