// The popin an uploaded track goes through: what to make of it once it is the song's — the lyrics
// off LRCLIB (off unless asked) and the instrumental (on). Cancelling uploads nothing.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { useEffect, useState } from "react";
import type { PipelineOptions } from "../fetchSong/run";
import { m } from "../paraglide/messages.js";
import { SwitchField } from "./SwitchField";

interface Props {
  /** The file waiting on the answer; null keeps the popin closed. */
  file: File | null;
  onConfirm: (options: Required<PipelineOptions>) => void;
  onCancel: () => void;
}

export function UploadTrackDialog({ file, onConfirm, onCancel }: Props) {
  const [lyrics, setLyrics] = useState(false);
  const [instrumental, setInstrumental] = useState(true);

  // Each file starts from the defaults, not from the previous answer.
  useEffect(() => {
    if (!file) return;
    setLyrics(false);
    setInstrumental(true);
  }, [file]);

  return (
    <Dialog open={file !== null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{m["uploadTrack.title"]()}</DialogTitle>
          <DialogDescription>{file?.name}</DialogDescription>
        </DialogHeader>

        <SwitchField checked={lyrics} onCheckedChange={setLyrics}>
          {m["uploadTrack.lyrics"]()}
        </SwitchField>
        <SwitchField checked={instrumental} onCheckedChange={setInstrumental}>
          {m["uploadTrack.instrumental"]()}
        </SwitchField>

        <div className="row">
          <Button onClick={() => onConfirm({ lyrics, instrumental })}>
            {m["uploadTrack.confirm"]()}
          </Button>
          <Button variant="outline" onClick={onCancel}>
            {m["common.cancel"]()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
