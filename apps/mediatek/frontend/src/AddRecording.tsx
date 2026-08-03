// AddRecording.tsx — le bouton de la section RECORDINGS. Pas de dialogue : une capture n'a
// rien à confirmer, elle se range à son heure d'enregistrement. La voie principale reste
// l'API (voir packages/mediatek/docs/recordings.md) ; ceci en est la porte manuelle, pour
// un lot rapatrié d'un enregistreur.

import { Button } from "@frediverse/ui/button";
import { AUDIO_ACCEPT } from "@studio/mediatek/media";
import { Loader2, Mic } from "lucide-react";
import { useRef, useState } from "react";
import { library } from "./api";

export function AddRecording({
  onDone,
  onError,
}: {
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const send = async (files: File[]) => {
    setBusy(true);
    try {
      await library.addRecordings(files);
      onDone();
    } catch (e) {
      // Un envoi partiel est un vrai résultat : les fichiers passés sont dans la zone, et
      // le rafraîchissement les montre malgré l'erreur.
      onDone();
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Mic className="mr-1 h-3.5 w-3.5" />
        )}
        Ajouter des captures
      </Button>
      <input
        ref={input}
        type="file"
        accept={AUDIO_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Vidé tout de suite : sans ça, rechoisir le même lot après une erreur n'émet
          // aucun change et le bouton paraît mort.
          e.target.value = "";
          if (files.length) void send(files);
        }}
      />
    </>
  );
}
