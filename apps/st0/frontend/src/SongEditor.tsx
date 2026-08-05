// SongEditor.tsx — a song opened: its `song.yaml` as text on the left, its master played and
// scrubbed on the right, the library tree still beside both. The same shape ChainEditor has,
// for the same reason: you edit the sidecar while hearing what it describes.
// See ../docs/songPlayer.md.

import { Button } from "@frediverse/ui/button";
import { type MediatekEntry, SONG_FILE } from "@studio/mediatek/types";
import { YamlPane } from "@studio/ui-module-builder/yaml-pane";
import { ArrowLeft, Disc3, Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { library } from "./api";
import { useModuleEngine } from "./engine/useModuleEngine";
import type { PlaybackTarget } from "./playback/targets";
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
  engineId,
  engineToken,
  playbackTarget,
  onBack,
  onSaved,
}: {
  entry: MediatekEntry;
  vimMode: boolean;
  /** The chosen machine's file service — the player needs it to have the master analysed. */
  fileBase?: string | null;
  /** …and the engine itself, which is what auditions a chain variant. */
  engineId?: string;
  engineToken?: string | null;
  /** Where the account wants sound to come out. See ../docs/playbackTarget.md. */
  playbackTarget: PlaybackTarget;
  onBack: () => void;
  onSaved: () => void;
}) {
  /**
   * ONE socket for this screen, held here and handed to both panes.
   *
   * It used to be opened inside `SongVariants`, which was correct while that pane was the only
   * thing here that made the moteur play. The player can now ask for the same engine, and two
   * hooks would be two connections to one machine from one tab — the very thing
   * `useEngineChoice` exists not to do. The pane above the variants and the pane below share a
   * transport anyway: one engine, one session, one thing playing at a time.
   */
  const engine = useModuleEngine(engineId);
  // …and stopping it when the screen goes is this component's job for the same reason: the
  // transport belongs to the editor, not to whichever pane last used it. Leaving is the one
  // gesture that must not leave a song playing on a machine in another room.
  useEffect(() => () => engine.stop(), [engine.stop]);
  // Two STRINGS, and that is the point: the listing is re-polled every three seconds, so
  // `entry` is a fresh object on every tick. An effect that depended on it would reload the
  // file — and throw away whatever had been typed into it — three times a minute.
  const folder = entry.path;
  const path = `${folder}/${SONG_FILE}`;
  const [content, setContent] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  // Absent is NOT an error, the way a module's missing panel is not: the editor opens on what
  // the file WOULD say, and the first save creates it through the ordinary write route.
  useEffect(() => {
    let alive = true;
    setContent(null);
    setDirty(false);
    setStatus("");
    void library
      .readFile(path)
      .then((f) => alive && setContent(f.content))
      .catch(() => {
        if (!alive) return;
        setContent(stub(folder));
        setStatus("pas encore de sidecar — enregistrer le créera");
      });
    return () => {
      alive = false;
    };
  }, [path, folder]);

  const save = useCallback(async () => {
    if (content == null) return;
    setSaving(true);
    try {
      await library.writeFile(path, content);
      setDirty(false);
      setStatus(`enregistré ${path}`);
      onSaved();
    } catch (e) {
      setStatus(`erreur : ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [content, path, onSaved]);

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
        <Button
          size="sm"
          className="ml-auto"
          variant={dirty ? "default" : "secondary"}
          disabled={saving || content == null}
          onClick={() => void save()}
        >
          {saving ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-1 h-4 w-4" />
          )}
          Enregistrer{dirty ? " *" : ""}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 w-1/2 shrink-0 border-r border-border">
          {content == null ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> chargement…
            </div>
          ) : (
            <YamlPane
              path={path}
              content={content}
              vimMode={vimMode}
              onChange={(text) => {
                setContent(text);
                setDirty(true);
              }}
              onSave={() => void save()}
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
              engine={engine}
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
