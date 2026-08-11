// EditorPanel.tsx — the "Editor" bottom panel: the content of the clip the user is currently
// on. The target comes from the active tab — the clip under the timeline caret, or the sequence
// open in the editor tab — lifted to the app shell so one panel serves every tab. What it draws
// is `ClipView`, which the graph slot mounts too; this adds only the empty state.

import { m } from "../paraglide/messages.js";
import { ClipView, type EditTarget } from "./ClipView";

export type { EditTarget };

export function EditorPanel({
  target,
  onClose,
  onCreateNote,
}: {
  target: EditTarget | null;
  onClose: () => void;
  // Draw a note into a sequence: (seqId, key, startBeat, endBeat). Runs `sequence note new`.
  onCreateNote?: (seqId: string, key: number, t0: number, t1: number) => void;
}) {
  if (!target)
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
        {m["editorPanel.nothing"]()}
      </div>
    );
  return (
    <ClipView target={target} onClose={onClose} onCreateNote={onCreateNote} />
  );
}
