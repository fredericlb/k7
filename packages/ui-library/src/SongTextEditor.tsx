// SongTextEditor.tsx — a song's chords or tablature typed by hand, as the songbook's song page takes
// them: a text box with Save and Cancel, the text saved whole. Saving an emptied text removes it
// (mediatek's docs/songbook.md), so the song's tab goes with it.

import { Button } from "@frediverse/ui/button";
import { Loader2 } from "@frediverse/ui/icons";
import { Textarea } from "@frediverse/ui/textarea";
import { useState } from "react";
import { useLabels } from "./host";

export function SongTextEditor({
  initial,
  placeholder,
  onSave,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  /** Write the text; the editor stays open with what was typed when it throws. */
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const labels = useLabels();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);

  const save = () => {
    setBusy(true);
    // A refusal is said by the caller; the editor only stays open with what was typed.
    void onSave(text)
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-2 p-4">
      {/* Monospace: a chord sits over its syllable and a tablature's columns line up only in one. */}
      <Textarea
        autoFocus
        value={text}
        placeholder={placeholder}
        className="min-h-[50vh] font-mono text-sm"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={onCancel}
          disabled={busy}
        >
          {labels.common.cancel}
        </Button>
        <Button size="sm" onClick={save} disabled={busy || text === initial}>
          {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {labels.song.save}
        </Button>
      </div>
    </div>
  );
}
