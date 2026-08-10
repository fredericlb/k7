// SongEditor.tsx — a song opened: its `song.yaml` as text on the left, its master played and
// scrubbed on the right, the library tree still beside both. The same shape ChainEditor has,
// for the same reason: you edit the sidecar while hearing what it describes.
// See ../docs/songPlayer.md.

import { Button } from "@frediverse/ui/button";
import { type MediatekEntry, SONG_FILE } from "@studio/mediatek/types";
import { recallBuffer, useAutosave } from "@studio/ui-editor/autosave";
import { YamlPane } from "@studio/ui-module-builder/yaml-pane";
import { ArrowLeft, Disc3, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { library } from "./api";
import { useEngine } from "./playback/PlaybackProvider";
import type { PlaybackTarget } from "./playback/targets";
import { SaveState } from "./SaveState";
import { SongPlayer } from "./SongPlayer";
import { SongVariants } from "./SongVariants";

/**
 * What a song with no sidecar opens on. Not a blank file: `title` is what the catalogue shows,
 * so a first save that names the song is the one edit this screen exists to make easy. A folder
 * found on disk with nothing filing it is exactly that case (`catalogued: false`).
 *
 * Built from the FOLDER and not from the entry, deliberately — see the load effect below.
 * Its last segment is the title tag, which for an unfiled song is the only name there is;
 * `MediatekEntry.name` falls back to the same string.
 */
const stub = (folder: string) =>
  `# ${folder}\ntitle: ${folder.split("/").pop() ?? ""}\n`;

export function SongEditor({
  entry,
  vimMode,
  fileBase,
  engineToken,
  playbackTarget,
  onBack,
  onSaved,
}: {
  entry: MediatekEntry;
  vimMode: boolean;
  /** The chosen machine's file service — the player needs it to have the master analysed.
   *  WHICH engine is no longer a prop: the app holds one and this screen asks for it. */
  fileBase?: string | null;
  engineToken?: string | null;
  /** Where the account wants sound to come out. See ../docs/playbackTarget.md. */
  playbackTarget: PlaybackTarget;
  onBack: () => void;
  onSaved: () => void;
}) {
  /**
   * The app's engine, not this screen's.
   *
   * It was opened here while a song could only be heard from this pane. It cannot be any more:
   * a song keeps playing after you leave, so its transport has to outlive the screen that
   * started it — and stopping on the way out, which used to live here, would silence exactly
   * the thing the bar at the bottom exists to keep. `PlaybackProvider` holds both now.
   */
  const engine = useEngine();
  // Two STRINGS, and that is the point: the listing is re-polled every three seconds, so
  // `entry` is a fresh object on every tick. An effect that depended on it would reload the
  // file — and throw away whatever had been typed into it — three times a minute.
  const folder = entry.path;
  const path = `${folder}/${SONG_FILE}`;
  const [content, setContent] = useState<string | null>(null);
  // What is on disk. Dirty is `content !== saved`, derived rather than a flag a failed write
  // could leave lying.
  const [saved, setSaved] = useState("");
  const [status, setStatus] = useState("");

  // Absent is NOT an error, the way a module's missing panel is not: the editor opens on what
  // the file WOULD say, and the first EDIT creates it through the ordinary write route. The
  // stub is `saved` too, deliberately — opening a song must not file it by itself.
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
        setStatus("pas encore de sidecar — la première modification le créera");
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
      setStatus(`enregistré ${path}`);
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-3 py-2">
        <Button variant="secondary" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Retour
        </Button>
        <div className="min-w-0">
          <div className="flex items-center gap-2 truncate text-sm font-semibold">
            <Disc3 className="h-4 w-4" /> Morceau · {entry.name}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {path}
          </div>
        </div>
        <SaveState autosave={autosave} className="ml-auto shrink-0" />
      </header>

      {/* Côte à côte dès qu'il y a la place, EMPILÉ sinon : deux moitiés d'un écran
          de téléphone font deux colonnes où rien ne tient. */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="min-h-0 h-1/2 shrink-0 border-b border-border md:h-auto md:w-1/2 md:border-r md:border-b-0">
          {content == null ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> chargement…
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
        {/* The player, and under it the versions the sidecar declares — they belong to the same
            half of the screen because they are the same question, "what does this song sound
            like". They used to be a fourth column, which only existed while nothing was open. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <SongPlayer
              entry={entry}
              fileBase={fileBase}
              engineToken={engineToken}
              target={playbackTarget}
            />
          </div>
          {entry.variants?.length ? (
            <div className="max-h-[45%] shrink-0 overflow-auto border-t p-3">
              <SongVariants
                entry={entry}
                engine={engine}
                engineToken={engineToken}
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
