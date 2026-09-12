// PlaybackPicker.tsx — the header's second icon button: where the médiathèque makes sound.
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
import { Check } from "lucide-react";
import { usePlayback } from "./PlaybackProvider";
import {
  effectiveTarget,
  PLAYBACK_TARGETS,
  type PlaybackTarget,
  playbackTargetInfo,
} from "./targets";

export function PlaybackPicker({
  target,
  onChoose,
}: {
  target: PlaybackTarget;
  onChoose: (t: PlaybackTarget) => void;
}) {
  // Read here rather than threaded down: the header sits INSIDE the provider that measures it.
  const { engineAvailable } = usePlayback();
  // The TRIGGER shows what will ACTUALLY play: it is all there is when the menu is shut.
  const actual = effectiveTarget(target, engineAvailable);
  const { icon: Icon, label } = playbackTargetInfo(actual);
  const fellBack = actual !== target;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Lecture : ${label}`}
          title={`Lecture : ${label}`}
        >
          <Icon
            className={`h-4 w-4 ${fellBack ? "text-muted-foreground" : ""}`}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Lecture</DropdownMenuLabel>
        {PLAYBACK_TARGETS.map((t) => {
          const RowIcon = t.icon;
          // Not disabled: the choice is remembered, and an unclickable row explains nothing.
          const unreachable = t.needsEngine && !engineAvailable;
          return (
            <DropdownMenuItem
              key={t.id}
              onSelect={() => onChoose(t.id)}
              className="items-start gap-2"
            >
              <RowIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  {t.label}
                  {t.id === target ? (
                    <Check className="h-3.5 w-3.5 shrink-0" />
                  ) : null}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {unreachable
                    ? "aucun moteur ne répond — lecture ici"
                    : t.hint}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
