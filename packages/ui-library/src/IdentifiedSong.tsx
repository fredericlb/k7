// IdentifiedSong.tsx — "Add a song"'s stop before a download whose identification is not the song
// typed: what was identified, or that nothing was, and the three ways out — ../docs/hunt.md.

import { Button } from "@frediverse/ui/button";
import { useLabels } from "./host";
import { describeTags, type Identified } from "./identifySong";

/** An identification that stops the download: another song, or none. */
export type Doubtful = Exclude<Identified, { kind: "same" }>;

/** What was identified, said against the names typed (`artist — title`). */
export function IdentifiedNotice({
  identified,
  typed,
}: {
  identified: Doubtful;
  typed: string;
}) {
  const l = useLabels().addSong;
  return (
    <div className="flex flex-col gap-2 text-sm">
      {identified.kind === "other" ? (
        <>
          <p>{l.identifiedOther}</p>
          <code className="block overflow-x-auto rounded bg-muted px-2 py-1.5 font-mono text-xs">
            {describeTags(identified.tags)}
          </code>
          <p className="text-xs text-muted-foreground">{l.anywayHint(typed)}</p>
        </>
      ) : (
        <>
          <p>{l.identifiedNone}</p>
          <p className="text-xs text-muted-foreground">{l.searchAnywayHint}</p>
        </>
      )}
    </div>
  );
}

/** Cancel, choose another way, or download it anyway — the popin's footer on that stop. */
export function IdentifiedActions({
  identified,
  busy,
  onCancel,
  onOtherWay,
  onAnyway,
}: {
  identified: Doubtful;
  busy: boolean;
  onCancel: () => void;
  onOtherWay: () => void;
  onAnyway: () => void;
}) {
  const labels = useLabels();
  const l = labels.addSong;
  return (
    <>
      <Button variant="secondary" disabled={busy} onClick={onCancel}>
        {labels.common.cancel}
      </Button>
      <Button variant="secondary" disabled={busy} onClick={onOtherWay}>
        {l.otherWay}
      </Button>
      <Button disabled={busy} onClick={onAnyway}>
        {identified.kind === "other" ? l.downloadAnyway : l.searchAnyway}
      </Button>
    </>
  );
}
