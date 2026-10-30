// SongEditor.tsx — a song opened: a header holding its play button and its ⋮ menu, over one
// column of tabs — the waveform first, then its tags and attachments. One column, since the
// waveform is a tab like the rest and a phone has room for one. See ../docs/songPlayer.md.

import { Button } from "@frediverse/ui/button";
import { ArrowLeft, Disc3, Pause, Play } from "@frediverse/ui/icons";
import type { MediatekEntry } from "@studio/mediatek/types";
import { clock } from "@studio/ui-mini-player";
import { useCallback, useEffect, useRef, useState } from "react";
import { library } from "./api";
import { useLabels } from "./host";
import { usePlaybackPosition } from "./playback/position";
import { SongInfoTabs } from "./SongInfoTabs";
import { SongMenu } from "./SongMenu";
import { useSongAttachments } from "./useSongAttachments";
import { type SongTransport, useSongTransport } from "./useSongTransport";

/** The header's clock, alone in reading the position so the page does not re-render with it. */
function HeaderClock({ transport }: { transport: SongTransport }) {
  const { position, duration } = usePlaybackPosition(transport.songLoaded);
  const at = transport.songLoaded ? position : transport.cursor;
  return (
    <span className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:inline">
      {clock(at)}
      {transport.songLoaded && duration ? ` / ${clock(duration)}` : ""}
    </span>
  );
}

export function SongEditor({
  entry,
  onBack,
  onSaved,
  manage,
}: {
  entry: MediatekEntry;
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
  const transport = useSongTransport(entry);
  const attachments = useSongAttachments(entry, onSaved, setStatus);
  // What is READ is transposed, never the audio; another song starts in its own key.
  const [transpose, setTranspose] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the song's path is the trigger
  useEffect(() => setTranspose(0), [folder]);

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

  const nothingToPlay = transport.path
    ? ""
    : transport.take?.kind === "master"
      ? l.noMaster
      : l.fileNotInLibrary;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={onBack}
          aria-label={labels.common.back}
        >
          <ArrowLeft className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">{labels.common.back}</span>
        </Button>
        <Button
          size="sm"
          onClick={transport.toggle}
          disabled={!transport.path && !transport.songPlaying}
          aria-label={
            transport.songPlaying ? labels.common.pause : labels.common.play
          }
          title={nothingToPlay}
        >
          {transport.songPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        <HeaderClock transport={transport} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 truncate text-sm font-semibold">
            <Disc3 className="h-4 w-4 shrink-0" />
            <span className="truncate">{l.heading(entry.name)}</span>
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {master ? `${folder}/${master}` : folder}
          </div>
        </div>
        <SongMenu
          entry={entry}
          attachments={attachments}
          transpose={transpose}
          onTranspose={setTranspose}
        />
      </header>

      <div className="min-h-0 flex-1">
        <SongInfoTabs
          entry={entry}
          attachments={attachments}
          transport={transport}
          transpose={transpose}
          onSaved={onSaved}
          onStatus={setStatus}
          onRemoveVariant={manage ? removeVariant : undefined}
        />
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t px-3 py-1 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{status}</span>
      </footer>
    </div>
  );
}
