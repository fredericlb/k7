// SongEditor.tsx — a song opened: its `song.yaml` as text on the left, its master played and
// scrubbed on the right, the library tree still beside both. The same shape ChainEditor has,
// for the same reason: you edit the sidecar while hearing what it describes.
// See ../docs/songPlayer.md.

import { Button } from "@frediverse/ui/button";
import { ArrowLeft, Disc3, Loader2 } from "@frediverse/ui/icons";
import { type MediatekEntry, SONG_FILE } from "@studio/mediatek/types";
import { recallBuffer, useAutosave } from "@studio/ui-editor/autosave";
import { YamlPane } from "@studio/ui-module-builder/yaml-pane";
import { useCallback, useEffect, useRef, useState } from "react";
import { library } from "./api";
import { useLabels } from "./host";
import type { PlaybackTarget } from "./playback/targets";
import { SaveState } from "./SaveState";
import { SongPlayer } from "./SongPlayer";
import { SongVariants } from "./SongVariants";

/** What a song with no sidecar opens on — a stub carrying `title`, built from the FOLDER. */
const stub = (folder: string) =>
  `# ${folder}\ntitle: ${folder.split("/").pop() ?? ""}\n`;

export function SongEditor({
  entry,
  vimMode,
  playbackTarget,
  onBack,
  onSaved,
  manage,
}: {
  entry: MediatekEntry;
  vimMode: boolean;
  /** The chosen machine's file service, which the player needs to have the master analysed. */
  /** Where the account wants sound to come out. See ../docs/playbackTarget.md. */
  playbackTarget: PlaybackTarget;
  onBack: () => void;
  onSaved: () => void;
  /** Whether this account may remove a variant — apps/k7/backend/docs/media/gate.md. */
  manage: boolean;
}) {
  const labels = useLabels();
  const l = labels.song;
  // Read by the effects below at the moment they speak, so a locale change reloads nothing.
  const said = useRef(l);
  said.current = l;
  // Two STRINGS, since the listing is re-polled and `entry` is a fresh object every tick.
  const folder = entry.path;
  const path = `${folder}/${SONG_FILE}`;
  const [content, setContent] = useState<string | null>(null);
  // What is on disk: dirty is derived from it, never a flag a failed write could leave lying.
  const [saved, setSaved] = useState("");
  const [status, setStatus] = useState("");

  // Absent is NOT an error: the stub is `saved` too, so opening a song does not file it.
  useEffect(() => {
    let alive = true;
    setContent(null);
    setStatus("");
    void library
      .readFile(path)
      .then((f) => {
        if (!alive) return;
        // An edit that could not be written outlived this screen — give it back, not disk.
        setContent(recallBuffer(path) ?? f.content);
        setSaved(f.content);
      })
      .catch(() => {
        if (!alive) return;
        setContent(recallBuffer(path) ?? stub(folder));
        setSaved(stub(folder));
        setStatus(said.current.noSidecar);
      });
    return () => {
      alive = false;
    };
  }, [path, folder]);

  // No Save button: written as soon as the sidecar parses.
  const write = useCallback(
    async (next: string) => {
      await library.writeFile(path, next);
      setSaved(next);
      setStatus(said.current.saved(path));
      onSaved();
    },
    [path, onSaved],
  );
  const autosave = useAutosave({
    path: content == null ? null : path,
    text: content ?? "",
    saved,
    write,
  });

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
            {path}
          </div>
        </div>
        <SaveState autosave={autosave} className="ml-auto shrink-0" />
      </header>

      {/* Side by side when there is room and STACKED when there is not (../docs/responsive.md). */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="min-h-0 h-1/2 shrink-0 border-b border-border md:h-auto md:w-1/2 md:border-r md:border-b-0">
          {content == null ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
              {labels.common.loading}
            </div>
          ) : (
            <YamlPane
              path={path}
              content={content}
              vimMode={vimMode}
              onChange={setContent}
              onSave={autosave.flush}
            />
          )}
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
