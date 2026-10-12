// LibraryContents.tsx — the middle of the catalogue when no song is open: the section's entries, or
// the capture zone's days, or the sentence saying why there is nothing to list.
// The one thing a reader would get wrong: an empty volume is an ANSWER, not an error (../docs/library.md).

import { Card } from "@frediverse/ui/card";
import { Loader2 } from "@frediverse/ui/icons";
import type { RecordingDay } from "@studio/mediatek/recordings";
import { type MediatekEntry, SONG_FILE } from "@studio/mediatek/types";
import { useLabels } from "./host";
import { bytes, isSong, relative } from "./libraryTree";

export function LibraryContents({
  notice,
  error,
  present,
  isZone,
  recordings,
  entries,
  onOpen,
}: {
  notice: string | null;
  error: string | null;
  present: boolean | null;
  isZone: boolean;
  recordings: RecordingDay[];
  entries: MediatekEntry[] | null;
  onOpen: (rel: string) => void;
}) {
  const l = useLabels();
  const units = l.common.units;
  return (
    <main className="min-w-0 flex-1 overflow-auto p-3 sm:p-6">
      {notice ? (
        <Card className="mb-4 p-4 text-sm text-muted-foreground">{notice}</Card>
      ) : null}
      {error ? (
        <Card className="p-4 text-sm text-destructive">{error}</Card>
      ) : present === false ? (
        // A real answer, not a failure: the volume is mounted but nothing is in it yet.
        <Card className="p-6 text-sm text-muted-foreground">
          {l.contents.emptyLibrary}
        </Card>
      ) : isZone ? (
        <RecordingDays days={recordings} />
      ) : entries === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : entries.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          {l.contents.emptyFamily}
        </Card>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex items-baseline gap-3 rounded-md px-3 py-2 hover:bg-accent/40"
              // A song OPENS, the way its tree row does: the two copies must not mean different things.
              onClick={() =>
                isSong(e)
                  ? onOpen(`${relative(e.path)}/${SONG_FILE}`)
                  : undefined
              }
            >
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              {/* Not filed: found on disk with no sidecar, and worth SAYING rather than hiding. */}
              {e.meta?.catalogued === false ? (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {l.contents.notCatalogued}
                </span>
              ) : null}
              {e.meta?.artist ? (
                <span className="text-xs text-muted-foreground">
                  {String(e.meta.artist)}
                </span>
              ) : null}
              {e.meta?.pack ? (
                <span className="text-xs text-muted-foreground">
                  {String(e.meta.pack)}
                </span>
              ) : null}
              <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                {e.kind}
              </span>
              <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {bytes(e.bytes, units)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/** The zone's own view: the captures by day, and no entry columns (packages/mediatek/docs/recordings.md). */
function RecordingDays({ days }: { days: RecordingDay[] }) {
  const l = useLabels();
  if (days.length === 0)
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        {l.contents.noRecordings}
      </Card>
    );
  return (
    <div className="flex flex-col gap-6">
      {days.map((d) => (
        <section key={d.day}>
          <h2 className="mb-1 text-sm font-semibold tabular-nums">
            {d.day}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {d.files.length}
            </span>
          </h2>
          <ul className="flex flex-col">
            {d.files.map((f) => (
              <li
                key={f.path}
                className="flex items-baseline gap-3 rounded-md px-3 py-1.5 hover:bg-accent/40"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-sm tabular-nums">
                  {f.name}
                </span>
                <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {bytes(f.bytes, l.common.units)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
