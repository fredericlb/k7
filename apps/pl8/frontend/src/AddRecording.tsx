// AddRecording.tsx — the RECORDINGS section's button. No dialog: a recording has nothing to
// confirm, it is filed by its own time. The main route stays the API (see
// packages/mediatek/docs/recordings.md); this is the manual door, for a batch brought back off a
// recorder.

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
      // A partial upload is a real result: the files that made it are in the zone, and the refresh
      // shows them despite the error.
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
        Ajouter des enregistrements
      </Button>
      <input
        ref={input}
        type="file"
        accept={AUDIO_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Cleared at once: otherwise re-picking the same batch after an error emits no change
          // and the button looks dead.
          e.target.value = "";
          if (files.length) void send(files);
        }}
      />
    </>
  );
}
