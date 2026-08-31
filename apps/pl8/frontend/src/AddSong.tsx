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
import { library, SongExists } from "./api";

/** The file's tags, or a guess from its name: an unreadable file is a form to fill in, not an error. */
async function readTags(file: File): Promise<SongTags> {
  const guess = tagsFromFilename(file.name);
  try {
    // Dynamic import: music-metadata is heavy, for a button nobody clicks on every visit.
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
}: {
  onDone: () => void;
  /** The chosen machine, for the analysis pass; null still uploads and simply defers it. */
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState<SongTags>({});
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The folder is taken: the question stays open, because replacing is a decision made here.
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
      // Fired AFTER closing and never awaited, since the first surface that needs it computes it anyway.
      void library
        .analyse(added.master)
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

  // Exactly what the server will build: the same functions, never a second copy of the rule.
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
          // The edited field aims elsewhere, so a remembered "Replace" would hit a song nobody saw.
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
          // Cleared at once, or re-picking the same file after an error emits no change.
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
            // `accept` is only the picker's default filter — "all files" stays one click away.
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
