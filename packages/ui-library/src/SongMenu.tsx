// SongMenu.tsx — the ⋮ at the far right of the song page's header: the date the song was added,
// a metronome on its tempo, the transposition of what is read, then the buttons that add lyrics,
// chords, a tab or a sheet. A popover rather than a menu, since its controls are used in place;
// the click track and the file input live outside it, so closing it stops neither. See ../docs/songPlayer.md.

import { Button } from "@frediverse/ui/button";
import {
  EllipsisVertical,
  FileMusic,
  Guitar,
  Loader2,
  MicVocal,
  Minus,
  Music,
  Play,
  Plus,
  RotateCcw,
  Square,
} from "@frediverse/ui/icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@frediverse/ui/popover";
import type { MediatekEntry } from "@studio/mediatek/types";
import { useMetronome } from "@studio/recorder/metronome";
import { SHEET_ACCEPT } from "@studio/rehearsal-shared/sheetKind";
import { useEffect, useRef, useState } from "react";
import { useLabels, useLibraryHost } from "./host";
import { addedOn, clampBpm, clampSemitones, songBpm } from "./songExtras";
import type { SongAttachments, Typed } from "./useSongAttachments";

const DEFAULT_BPM = 120;

export function SongMenu({
  entry,
  attachments: a,
  transpose,
  onTranspose,
}: {
  entry: MediatekEntry;
  attachments: SongAttachments;
  transpose: number;
  onTranspose: (semitones: number) => void;
}) {
  const l = useLabels().song;
  const { songAttachment } = useLibraryHost();
  const [open, setOpen] = useState(false);
  const sheetInput = useRef<HTMLInputElement>(null);

  const tagged = songBpm(entry.meta);
  const [bpm, setBpm] = useState(tagged ?? DEFAULT_BPM);
  const { metronome, start, stop } = useMetronome();
  const running = metronome != null;
  // Another song, or its tempo retagged: the click takes the new tempo and stops.
  useEffect(() => {
    setBpm(tagged ?? DEFAULT_BPM);
    stop();
  }, [tagged, stop]);
  // A live tempo change restarts the click a moment later, so a run of presses spares the context.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the TEMPO is the trigger; `running` and `start` are read, not watched.
  useEffect(() => {
    if (!running || metronome?.bpm === bpm) return;
    const id = window.setTimeout(() => start(bpm, 0), 120);
    return () => clearTimeout(id);
  }, [bpm]);

  const added = addedOn(a.song, entry);

  const add = (kind: Typed) => {
    a.startTyping(kind);
    setOpen(false);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={l.menu}
            title={l.menu}
            className={running ? "text-primary" : undefined}
          >
            <EllipsisVertical className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-72 flex-col gap-3 p-3">
          {added ? (
            <div className="text-xs text-muted-foreground">
              <div className="text-sm text-foreground">
                {l.addedOn(
                  added.at.toLocaleDateString(undefined, {
                    dateStyle: "medium",
                  }),
                )}
              </div>
              {added.from === "files" ? l.addedFromFiles : null}
            </div>
          ) : null}

          <section className="flex flex-col gap-1 border-t pt-2">
            <div className="text-xs font-semibold">{l.metronome}</div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                aria-label={l.slower}
                onClick={() => setBpm((b) => clampBpm(b - 1))}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <input
                type="number"
                inputMode="numeric"
                aria-label={l.tempo}
                className="h-8 w-16 rounded-md border bg-background px-2 text-center text-sm tabular-nums"
                value={bpm}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0) setBpm(clampBpm(n));
                }}
              />
              <span className="text-xs text-muted-foreground">BPM</span>
              <Button
                variant="outline"
                size="sm"
                aria-label={l.faster}
                onClick={() => setBpm((b) => clampBpm(b + 1))}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={running ? "default" : "secondary"}
                size="sm"
                className="ml-auto"
                aria-pressed={running}
                aria-label={running ? l.metronomeStop : l.metronomeStart}
                title={running ? l.metronomeStop : l.metronomeStart}
                onClick={() => (running ? stop() : start(bpm, 0))}
              >
                {running ? (
                  <Square className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
            {tagged === null ? (
              <div className="text-xs text-muted-foreground">{l.noBpm}</div>
            ) : null}
          </section>

          <section className="flex flex-col gap-1 border-t pt-2">
            <div className="text-xs font-semibold">{l.transpose}</div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                aria-label={l.transposeDown}
                onClick={() => onTranspose(clampSemitones(transpose - 1))}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="w-10 text-center text-sm tabular-nums">
                {transpose > 0 ? `+${transpose}` : transpose}
              </span>
              <Button
                variant="outline"
                size="sm"
                aria-label={l.transposeUp}
                onClick={() => onTranspose(clampSemitones(transpose + 1))}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={l.transposeReset}
                title={l.transposeReset}
                disabled={transpose === 0}
                onClick={() => onTranspose(0)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              {l.transposeHint}
            </div>
          </section>

          {/* Offered only where the host can draw what they add. */}
          {songAttachment ? (
            <section className="flex flex-col gap-1 border-t pt-2">
              {!a.has.lyrics && a.editing !== "lyrics" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  disabled={a.looking}
                  onClick={() => add("lyrics")}
                >
                  {a.looking ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <MicVocal className="mr-2 h-3.5 w-3.5" />
                  )}
                  {a.looking ? l.lookingForLyrics : l.addLyrics}
                </Button>
              )}
              {!a.has.chords && a.editing !== "chords" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  onClick={() => add("chords")}
                >
                  <Music className="mr-2 h-3.5 w-3.5" /> {l.addChords}
                </Button>
              )}
              {!a.has.tablature && a.editing !== "tablature" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  onClick={() => add("tablature")}
                >
                  <Guitar className="mr-2 h-3.5 w-3.5" /> {l.addTab}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="justify-start"
                disabled={a.sending}
                onClick={() => {
                  sheetInput.current?.click();
                  setOpen(false);
                }}
              >
                {a.sending ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileMusic className="mr-2 h-3.5 w-3.5" />
                )}
                {a.sending ? l.sendingSheets : l.addSheet}
              </Button>
            </section>
          ) : null}
        </PopoverContent>
      </Popover>
      <input
        ref={sheetInput}
        type="file"
        multiple
        accept={SHEET_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Cleared at once, or picking the same file again after an error emits no change.
          e.target.value = "";
          if (files.length) void a.sendSheets(files);
        }}
      />
    </>
  );
}
