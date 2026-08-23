// AddSong.tsx — the add-a-song button: pick an audio file, its tags are read in the browser, and
// the derived tree is shown BEFORE uploading, because that tree and not a file name is what
// decides where the song is filed.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Input } from "@frediverse/ui/input";
import { Label } from "@frediverse/ui/label";
import { AUDIO_ACCEPT, isAudio } from "@studio/mediatek/media";
import {
  masterName,
  type SongTags,
  songFolder,
  tagsFromFilename,
} from "@studio/mediatek/song";
import { Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { engineMachine, library, SongExists } from "./api";

/** The file's tags, or what its name lets us guess. An unreadable file is not an error: it is a
 *  form to fill in by hand, which the dialog already allows. */
async function readTags(file: File): Promise<SongTags> {
  const guess = tagsFromFilename(file.name);
  try {
    // Dynamic import: music-metadata parses a dozen containers and is heavy, for a button nobody
    // clicks on every visit.
    const { parseBlob } = await import("music-metadata");
    const { common } = await parseBlob(file, { duration: false });
    return {
      artist: common.artist || common.albumartist || guess.artist || "",
      album: common.album || "",
      title: common.title || guess.title || "",
    };
  } catch {
    return { artist: guess.artist ?? "", album: "", title: guess.title ?? "" };
  }
}

export function AddSong({
  onDone,
  engine,
}: {
  onDone: () => void;
  /** The chosen machine, for the analysis pass. Null when none is reachable — the upload
   *  still lands, and the analysis is simply deferred (see `send`). */
  engine: { fileBase: string | null; token: string | null };
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState<SongTags>({});
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The folder is taken. Keep the question open rather than closing on an error: replacing is a
  // decision, and this is the only screen where it makes sense.
  const [occupied, setOccupied] = useState(false);

  const close = () => {
    setFile(null);
    setError(null);
    setOccupied(false);
  };

  const pick = async (f: File) => {
    setFile(f);
    setError(null);
    setOccupied(false);
    setTags({});
    setReading(true);
    setTags(await readTags(f));
    setReading(false);
  };

  const send = async (replace: boolean) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const added = await library.addSong(
        file,
        {
          artist: tags.artist ?? "",
          album: tags.album ?? "",
          title: tags.title ?? "",
        },
        { replace },
      );
      close();
      onDone();
      // The waveform cache, the onsets and the tempo, computed on the machine that has an
      // engine — this app cannot decode audio. Fired AFTER closing, and never awaited: it
      // decodes a whole file, and holding the dialogue open for it would make an upload feel
      // as slow as an analysis. With no reachable machine nothing happens here, and the first
      // surface that needs the cache computes it then.
      if (engine.fileBase && engine.token)
        void engineMachine
          .analyse(engine.fileBase, engine.token, added.master)
          .then(onDone)
          .catch(() => {
            /* the song is filed either way; the cache is a derived thing */
          });
    } catch (e) {
      if (e instanceof SongExists) setOccupied(true);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Exactly what the server will build: the same functions, imported from the package, and not a
  // second copy of the rule that would drift from it.
  const folder = songFolder(tags);
  const master = file && isAudio(file.name) ? masterName(file.name) : "";

  const field = (
    key: "artist" | "album" | "title",
    label: string,
    placeholder: string,
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`song-${key}`}>{label}</Label>
      <Input
        id={`song-${key}`}
        value={tags[key] ?? ""}
        placeholder={placeholder}
        onChange={(e) => {
          setTags((t) => ({ ...t, [key]: e.target.value }));
          // The edited field aims at another folder: the remembered "Replace" would then apply to
          // a song nobody looked at.
          setOccupied(false);
        }}
      />
    </div>
  );

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => input.current?.click()}
      >
        <Upload className="mr-1 h-3.5 w-3.5" /> Ajouter un morceau
      </Button>
      <input
        ref={input}
        type="file"
        accept={AUDIO_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          // Cleared at once: otherwise re-picking the same file after an error emits no change
          // and the button looks dead.
          e.target.value = "";
          if (f) void pick(f);
        }}
      />

      <Dialog
        open={file !== null}
        onOpenChange={(o) => {
          if (!o && !busy) close();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ajouter un morceau</DialogTitle>
            <DialogDescription>
              {reading
                ? "Lecture des tags…"
                : "Ces trois champs décident du rangement. Le fichier garde son format."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {field("artist", "Artiste", "Artiste inconnu")}
            {field("album", "Album", "Album inconnu")}
            {field("title", "Titre", "Sans titre")}
          </div>

          {master ? (
            <code className="block overflow-x-auto rounded bg-muted px-2 py-1.5 font-mono text-xs text-muted-foreground">
              {folder}/{master}
            </code>
          ) : (
            // `accept` is only the picker's default filter: "all files" stays one click away, and
            // an upload refused silently is worse than a refusal.
            <div className="text-xs text-destructive">
              {file?.name} n'est pas un fichier audio que la médiathèque sait
              lire.
            </div>
          )}

          {occupied && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-500">
              Un morceau occupe déjà ce dossier. Le remplacer, ou changer un des
              trois champs pour le ranger ailleurs.
            </div>
          )}
          {error && (
            <code className="block max-w-full overflow-x-auto rounded bg-muted px-2 py-1 text-xs text-red-400">
              {error}
            </code>
          )}

          <DialogFooter>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Annuler
            </Button>
            <Button
              onClick={() => void send(occupied)}
              disabled={busy || reading || !master}
            >
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {occupied ? "Remplacer" : "Envoyer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
