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
import { makeInstrumental } from "../fetchSong/run";
import { m } from "../paraglide/messages.js";
import type { Song, SongTab } from "../types";

interface Props {
  song: Song;
  /** Open the editor of a text kind the song does not have yet. */
  onAdd: (kind: "lyrics" | "tablature") => void;
  onUploadSheets: (files: File[]) => Promise<void>;
  onUploadAudio: (file: File) => Promise<void>;
  /** Take the reference track away — the player only PLAYS it. */
  onDeleteAudio: () => Promise<void>;
  /** The timed-lyrics popin is owned by the page, so both this menu and the fetch insert share one. */
  onOpenTimedLyrics: () => void;
  /** Retries the instrumental once no engine was online — the auto-fetch insert covers the rest. */
  onMixInstrumental: (folder: string) => Promise<Song>;
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
  onOpenTimedLyrics,
  onMixInstrumental,
  onDelete,
  has,
}: Props) {
  const sheets = useRef<HTMLInputElement>(null);
  const track = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

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

          <DropdownMenuItem onSelect={onOpenTimedLyrics}>
            Add timed lyrics…
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* No track yet is the auto-fetch insert's job, under the title. */}
          {song.audio && (
            <DropdownMenuItem onSelect={() => track.current?.click()}>
              Replace the track…
            </DropdownMenuItem>
          )}
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
