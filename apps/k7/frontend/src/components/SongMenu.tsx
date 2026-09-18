// The ⋮ beside a song's title: everything a song can be GIVEN, and what it can lose.
// One menu rather than a row of links, so the page below is the song and not its verbs.
// What it is doing, and what it could not do, hangs under the button — ../../docs/audio.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { SHEET_ACCEPT } from "@k7/shared/sheetKind";
import { useRef, useState } from "react";
import { pl8 } from "../fetchSong/pl8";
import { fetchSong, makeInstrumental } from "../fetchSong/run";
import { m } from "../paraglide/messages.js";
import type { LrcCandidate, LyricTiming, Song, SongTab } from "../types";
import { TimedLyricsDialog } from "./TimedLyricsDialog";

interface Props {
  song: Song;
  /** Open the editor of a text kind the song does not have yet. */
  onAdd: (kind: "lyrics" | "tablature") => void;
  onUploadSheets: (files: File[]) => Promise<void>;
  onUploadAudio: (file: File) => Promise<void>;
  /** Take the reference track away — the player only PLAYS it. */
  onDeleteAudio: () => Promise<void>;
  /** Save what the timed-lyrics popin settled: the lyrics when the file brought them, and the timecodes. */
  onLrc: (lyrics: string | null, timings: LyricTiming[]) => Promise<void>;
  onFindLrc: (duration?: number) => Promise<LrcCandidate[]>;
  /** The reference track's length, for ranking what LRCLIB offers. */
  trackSeconds: () => number | undefined;
  onCopyTrack: (path: string) => Promise<void>;
  onMixInstrumental: (folder: string) => Promise<void>;
  onDelete: () => Promise<void>;
  /** Which tabs the song already has, so the menu offers the ones it has not. */
  has: (tab: SongTab) => boolean;
}

export function SongMenu({
  song,
  onAdd,
  onUploadSheets,
  onUploadAudio,
  onDeleteAudio,
  onLrc,
  onFindLrc,
  trackSeconds,
  onCopyTrack,
  onMixInstrumental,
  onDelete,
  has,
}: Props) {
  const sheets = useRef<HTMLInputElement>(null);
  const track = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // The timed-lyrics popin owns getting an LRC and pairing it; this only opens it.
  const [timedOpen, setTimedOpen] = useState(false);

  /** Every entry runs through here: one thing at a time, and its failure under the button. */
  const run = async (what: string, act: () => Promise<string | void>) => {
    setPhase(what);
    setError(null);
    setNote(null);
    try {
      setNote((await act()) || null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPhase(null);
    }
  };

  const picked = (
    input: HTMLInputElement | null,
    act: (files: File[]) => Promise<void>,
    what: string,
  ) => {
    const files = input?.files ? Array.from(input.files) : [];
    if (input) input.value = "";
    if (files.length) void run(what, () => act(files));
  };

  return (
    <div className="song-menu">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            title="What this song can be given"
            aria-label="Song menu"
            disabled={phase !== null}
          >
            ⋮
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {!has("lyrics") && (
            <DropdownMenuItem onSelect={() => onAdd("lyrics")}>
              Add lyrics
            </DropdownMenuItem>
          )}
          {!has("tablature") && (
            <DropdownMenuItem onSelect={() => onAdd("tablature")}>
              Add tablature
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => sheets.current?.click()}>
            Add images, PDF or a score…
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => setTimedOpen(true)}>
            Add timed lyrics…
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* One entry, two words: there is no track to replace until there is one. */}
          <DropdownMenuItem onSelect={() => track.current?.click()}>
            {song.audio ? "Replace the track…" : "Add a track…"}
          </DropdownMenuItem>
          {song.audio && (
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => {
                if (confirm("Remove the track from this song?"))
                  void run("Removing the track…", onDeleteAudio);
              }}
            >
              Remove the track
            </DropdownMenuItem>
          )}
          {!song.audio && (
            <DropdownMenuItem
              onSelect={() =>
                run("Fetching the song…", () =>
                  fetchSong(song, {
                    pl8,
                    copyTrack: onCopyTrack,
                    onPhase: setPhase,
                  }),
                )
              }
            >
              Fetch song
            </DropdownMenuItem>
          )}
          {song.audio && !song.instrumental && (
            <DropdownMenuItem
              onSelect={() =>
                run("Making the instrumental…", async () => {
                  const outcome = await makeInstrumental(song, {
                    pl8,
                    mixInstrumental: onMixInstrumental,
                    onPhase: setPhase,
                  });
                  return outcome.note;
                })
              }
            >
              Make instrumental
            </DropdownMenuItem>
          )}

          {song.mine && (
            <>
              <DropdownMenuSeparator />
              {/* Everyone edits the shared songbook; only a song's creator deletes it. */}
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() => void onDelete()}
              >
                Delete song
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={sheets}
        type="file"
        accept={SHEET_ACCEPT}
        multiple
        hidden
        onChange={() =>
          picked(sheets.current, onUploadSheets, m["sheet.uploading"]())
        }
      />
      <input
        ref={track}
        type="file"
        accept="audio/*"
        hidden
        onChange={() =>
          picked(
            track.current,
            (files) => onUploadAudio(files[0]),
            "Uploading…",
          )
        }
      />
      <TimedLyricsDialog
        open={timedOpen}
        onOpenChange={setTimedOpen}
        lyrics={song.lyrics}
        onFindLrc={onFindLrc}
        trackSeconds={trackSeconds}
        onSave={onLrc}
      />

      {(phase || error || note) && (
        <div className="song-menu-status">
          {phase && <span className="muted small">{phase}</span>}
          {note && <span className="muted small">{note}</span>}
          {error && <span className="error small">{error}</span>}
        </div>
      )}
    </div>
  );
}
