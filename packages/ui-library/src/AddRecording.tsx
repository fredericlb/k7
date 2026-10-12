// AddRecording.tsx — the RECORDINGS section's button. No dialog: a recording has nothing to
// confirm, it is filed by its own time. The main route stays the API (see
// packages/mediatek/docs/recordings.md); this is the manual door, for a batch brought back off a
// recorder.

import { Button } from "@frediverse/ui/button";
import { Loader2, Mic, X } from "@frediverse/ui/icons";
import { AUDIO_ACCEPT } from "@studio/mediatek/media";
import { useRef, useState } from "react";
import { library } from "./api";
import { useLabels } from "./host";

export function AddRecording({
  onDone,
  onError,
}: {
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const l = useLabels().addRecording;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // The batch in flight: while it runs, the button is what cuts it.
  const sending = useRef<AbortController | null>(null);

  const send = async (files: File[]) => {
    const ctl = new AbortController();
    sending.current = ctl;
    setBusy(true);
    try {
      await library.addRecordings(files, ctl.signal);
      onDone();
    } catch (e) {
      // A partial upload is a real result, so the refresh runs despite the error.
      onDone();
      if (!ctl.signal.aborted) onError((e as Error).message);
    } finally {
      sending.current = null;
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          busy ? sending.current?.abort() : input.current?.click()
        }
      >
        {busy ? (
          <>
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            {l.sending} <X className="ml-1 h-3.5 w-3.5" /> {l.cancel}
          </>
        ) : (
          <>
            <Mic className="mr-1 h-3.5 w-3.5" />
            {l.add}
          </>
        )}
      </Button>
      <input
        ref={input}
        type="file"
        accept={AUDIO_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Cleared at once, or re-picking the same batch after an error emits no change.
          e.target.value = "";
          if (files.length) void send(files);
        }}
      />
    </>
  );
}
