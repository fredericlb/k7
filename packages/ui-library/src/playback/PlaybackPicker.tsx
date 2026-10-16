// PlaybackPicker.tsx — an icon button for the host's chrome: where the media library makes sound.
// A menu of destinations, drawn from PLAYBACK_TARGETS, so a fourth one is an entry in that
// list and no change here. See ../../docs/playbackTarget.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { Check } from "@frediverse/ui/icons";
import { useLabels } from "../host";
import { usePlayback } from "./PlaybackProvider";
import {
  effectiveTarget,
  offered,
  PLAYBACK_TARGETS,
  playbackTargetInfo,
} from "./targets";

/** Must sit INSIDE `MediaPlayback`: the destination and the engine's answer are both its. */
export function PlaybackPicker() {
  const { engineAvailable, hostPlayerAvailable, target, choose } =
    usePlayback();
  const ready = { engine: engineAvailable, hostPlayer: hostPlayerAvailable };
  const l = useLabels().playback;
  // The TRIGGER shows what will ACTUALLY play: it is all there is when the menu is shut.
  const actual = effectiveTarget(target, ready);
  const { icon: Icon } = playbackTargetInfo(actual);
  const label = l.targets[actual].label;
  const fellBack = actual !== target;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={l.picker(label)}
          title={l.picker(label)}
        >
          <Icon
            className={`h-4 w-4 ${fellBack ? "text-muted-foreground" : ""}`}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{l.title}</DropdownMenuLabel>
        {PLAYBACK_TARGETS.filter((t) => offered(t, ready)).map((t) => {
          const RowIcon = t.icon;
          // Not disabled: the choice is remembered, and an unclickable row explains nothing.
          const unreachable = t.needsEngine && !engineAvailable;
          return (
            <DropdownMenuItem
              key={t.id}
              onSelect={() => choose(t.id)}
              className="items-start gap-2"
            >
              <RowIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  {l.targets[t.id].label}
                  {t.id === target ? (
                    <Check className="h-3.5 w-3.5 shrink-0" />
                  ) : null}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {unreachable ? l.noEngine : l.targets[t.id].hint}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
