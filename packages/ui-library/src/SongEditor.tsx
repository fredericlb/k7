// SongEditor.tsx — a song opened: the médiathèque's header holding its play button and its ⋮ menu, over one
// column of tabs — its info first, the tags over the waveform, then its attachments. One column,
// since a phone has room for one. Its parts read and write through the song's source (songSource.ts),
// which a server song on the phone points at the server, or makes read-only. See ../docs/songPlayer.md.

import { Button } from "@frediverse/ui/button";
import { CloudOff, Disc3, Pause, Play } from "@frediverse/ui/icons";
import type { MediatekEntry } from "@studio/mediatek/types";
import { clock } from "@studio/ui-mini-player";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLabels } from "./host";
import { LibraryPage } from "./LibraryPage";
import { usePlaybackPosition } from "./playback/position";
import { SongInfoTabs } from "./SongInfoTabs";
import { SongMenu } from "./SongMenu";
import { type SongSource, SongSourceProvider } from "./songSource";
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

/** Why the song cannot be changed here, over its tabs. */
export function ReadOnlyNotice({ said }: { said: string }) {
  return (
    <p className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
      <CloudOff className="size-3.5 shrink-0" />
      <span className="min-w-0">{said}</span>
    </p>
  );
}

export function SongEditor(p: {
  entry: MediatekEntry;
  source: SongSource;
  onBack: () => void;
  onSaved: () => void;
  /** Whether this account may remove a variant — apps/k7/backend/docs/media/gate.md. */
  manage: boolean;
}) {
  return (
    <SongSourceProvider value={p.source}>
      <SongPage {...p} />
    </SongSourceProvider>
  );
}

function SongPage({
  entry,
  source,
  onBack,
  onSaved: listed,
  manage,
}: {
  entry: MediatekEntry;
  source: SongSource;
  onBack: () => void;
  onSaved: () => void;
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
  const { afterWrite, write } = source;
  // An edit landed: the listing here, and the copy here when the edit went to the server's version.
  const onSaved = useCallback(() => {
    listed();
    afterWrite();
  }, [listed, afterWrite]);
  const transport = useSongTransport(entry, source.streamBase);
  const attachments = useSongAttachments(entry, onSaved, setStatus);
  // What is READ is transposed, never the audio; another song starts in its own key.
  const [transpose, setTranspose] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the song's path is the trigger
  useEffect(() => setTranspose(0), [folder]);

  const removeVariant = useCallback(
    (name: string) => {
      if (!write) return;
      void write
        .removeVariant(folder, name)
        .then(() => {
          setStatus(said.current.variantRemoved(name));
          onSaved();
        })
        .catch((e: Error) => setStatus(e.message));
    },
    [folder, onSaved, write],
  );

  const nothingToPlay = transport.path
    ? ""
    : transport.take?.kind === "master"
      ? l.noMaster
      : l.fileNotInLibrary;

  return (
    <LibraryPage
      fill
      onBack={onBack}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <Disc3 className="size-5 shrink-0" />
          <span className="truncate">{l.heading(entry.name)}</span>
        </span>
      }
      sub={master ? `${folder}/${master}` : folder}
      actions={
        <>
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
          <SongMenu
            entry={entry}
            attachments={attachments}
            transpose={transpose}
            onTranspose={setTranspose}
          />
        </>
      }
    >
      {source.readOnly ? <ReadOnlyNotice said={source.readOnly} /> : null}
      <div className="min-h-0 flex-1">
        <SongInfoTabs
          entry={entry}
          attachments={attachments}
          transport={transport}
          transpose={transpose}
          onSaved={onSaved}
          onStatus={setStatus}
          onRemoveVariant={manage && write ? removeVariant : undefined}
        />
      </div>

      <footer className="flex shrink-0 items-center gap-3 px-3 py-1 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{status}</span>
      </footer>
    </LibraryPage>
  );
}
