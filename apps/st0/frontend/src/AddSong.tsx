// AddSong.tsx — le bouton d'ajout d'un morceau : on choisit un fichier audio, ses tags
// sont lus dans le navigateur, et l'arborescence déduite est montrée AVANT l'envoi, parce
// que c'est elle et non un nom de fichier qui décide où le morceau se range.

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

/** Les tags du fichier, ou ce que son nom en laisse deviner. Un fichier illisible n'est pas
 *  une erreur : c'est un formulaire à remplir à la main, ce que le dialogue permet déjà. */
async function readTags(file: File): Promise<SongTags> {
  const guess = tagsFromFilename(file.name);
  try {
    // Import dynamique : music-metadata parse une douzaine de conteneurs et pèse lourd,
    // pour un bouton qu'on ne clique pas à chaque visite.
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

export function AddSong({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState<SongTags>({});
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Le dossier est déjà pris. On garde la question ouverte au lieu de la refermer sur une
  // erreur : remplacer est une décision, et c'est le seul écran où elle a du sens.
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
      await library.addSong(
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
    } catch (e) {
      if (e instanceof SongExists) setOccupied(true);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Exactement ce que le serveur construira : les mêmes fonctions, importées du package, et
  // non une deuxième version de la règle qui finirait par en diverger.
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
          // Le champ modifié vise un autre dossier : le « Remplacer » retenu porterait
          // alors sur un morceau que personne n'a regardé.
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
          // Vidé tout de suite : sans ça, rechoisir le même fichier après une erreur
          // n'émet aucun change et le bouton paraît mort.
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
            // `accept` n'est qu'un filtre par défaut du sélecteur : « tous les fichiers »
            // reste à un clic, et un envoi refusé sans rien dire est pire qu'un refus.
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
