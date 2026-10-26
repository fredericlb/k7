// SongEditor.tsx — a song opened: its tags and attachments on the left, its master played and scrubbed on the
// right, the library tree still beside both. The same shape ChainEditor has, for the same
// reason: you correct what describes the song while hearing it. See ../docs/songPlayer.md.

import { Button } from "@frediverse/ui/button";
import { ArrowLeft, Disc3 } from "@frediverse/ui/icons";
import type { MediatekEntry } from "@studio/mediatek/types";
import { useCallback, useRef, useState } from "react";
import { library } from "./api";
import { useLabels } from "./host";
import type { PlaybackTarget } from "./playback/targets";
import { SongInfoTabs } from "./SongInfoTabs";
import { SongPlayer } from "./SongPlayer";
import { SongVariants } from "./SongVariants";

export function SongEditor({
  entry,
  playbackTarget,
  onBack,
  onSaved,
  manage,
}: {
  entry: MediatekEntry;
  /** Where the account wants sound to come out. See ../docs/playbackTarget.md. */
  playbackTarget: PlaybackTarget;
  onBack: () => void;
  onSaved: () => void;
  /** Whether this account may remove a variant — apps/k7/backend/docs/media/gate.md. */
  manage: boolean;
}) {
  const labels = useLabels();
  const l = labels.song;
  // Read by the callbacks below at the moment they speak, so a locale change reloads nothing.
  const said = useRef(l);
  said.current = l;
  // A STRING, since the listing is re-polled and `entry` is a fresh object every tick.
  const folder = entry.path;
  const master = entry.meta?.master;
  const [status, setStatus] = useState("");

  const removeVariant = useCallback(
    (name: string) => {
      void library
        .removeVariant(folder, name)
        .then(() => {
          setStatus(said.current.variantRemoved(name));
          onSaved();
        })
        .catch((e: Error) => setStatus(e.message));
    },
    [folder, onSaved],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-3 py-2">
        <Button variant="secondary" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> {labels.common.back}
        </Button>
        <div className="min-w-0">
          <div className="flex items-center gap-2 truncate text-sm font-semibold">
            <Disc3 className="h-4 w-4" /> {l.heading(entry.name)}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {master ? `${folder}/${master}` : folder}
          </div>
        </div>
      </header>

      {/* Side by side when there is room and STACKED when there is not (../docs/responsive.md). */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="min-h-0 h-1/2 shrink-0 border-b border-border md:h-auto md:w-1/2 md:border-r md:border-b-0">
          <SongInfoTabs entry={entry} onSaved={onSaved} onStatus={setStatus} />
        </div>
        {/* The player and the versions under it: one half of the screen, one question. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <SongPlayer entry={entry} target={playbackTarget} />
          </div>
          {entry.variants?.length ? (
            <div className="max-h-[45%] shrink-0 overflow-auto border-t p-3">
              <SongVariants
                entry={entry}
                onRemove={manage ? removeVariant : undefined}
              />
            </div>
          ) : null}
        </div>
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t px-3 py-1 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{status}</span>
      </footer>
    </div>
  );
}
