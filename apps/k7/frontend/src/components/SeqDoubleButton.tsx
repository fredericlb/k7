// SeqDoubleButton.tsx — the ×2 in a note grid's header: the sequence twice as long, playing
// twice. One control in two headers (the step grid's and the roll's), because a button drawn in
// both has to mean the same thing in both. What it writes is `sequence double`, which is where
// what a "length" is here is decided. See ../../docs/clipEditors.md.

import { m } from "../paraglide/messages.js";

export function SeqDoubleButton({
  seqId,
  command,
}: {
  seqId: string;
  /** Absent ⇒ nothing is drawn: a grid that cannot be edited offers no edit. */
  command?: (line: string) => void | Promise<void>;
}) {
  if (!command) return null;
  return (
    <button
      type="button"
      title={m["seq.doubleHint"]()}
      onClick={() => void command(`sequence double ${seqId}`)}
      className="rounded px-1.5 py-0.5 tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      ×2
    </button>
  );
}
