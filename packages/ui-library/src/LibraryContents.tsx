// LibraryContents.tsx — the middle of the catalogue when no song is open: the section's entries, or
// the capture zone's days, or the sentence saying why there is nothing to list.
// The one thing a reader would get wrong: an empty volume is an ANSWER, not an error (../docs/library.md).

import { Card } from "@frediverse/ui/card";
import { Inbox, Loader2 } from "@frediverse/ui/icons";
import type { RecordingDay } from "@studio/mediatek/recordings";
import { type MediatekEntry, SONG_FILE } from "@studio/mediatek/types";
import type { ReactNode } from "react";
import { useLabels } from "./host";
import { bytes, isSong, relative } from "./libraryTree";
import { PlacementIcon, type useServerCopy } from "./ServerCopy";

/** Nothing to list: the sentence and the act that adds the first one, as k7's own empty pages draw it (apps/k7/frontend/src/projects/EmptyState.tsx). */
function EmptyBlock({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <p className="max-w-md text-muted-foreground text-sm">{children}</p>
      {actions && (
        <div className="flex flex-wrap justify-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export function LibraryContents({
  notice,
  error,
  present,
  isZone,
  recordings,
  entries,
  serverCopy,
  onOpen,
  emptyActions,
  narrowHidden = false,
}: {
  /** Drawn only from `md` up: below, the tree stands in for this pane. */
  narrowHidden?: boolean;
  notice: string | null;
  error: string | null;
  present: boolean | null;
  isZone: boolean;
  recordings: RecordingDay[];
  entries: MediatekEntry[] | null;
  serverCopy: ReturnType<typeof useServerCopy>;
  onOpen: (rel: string) => void;
  /** What adds the first entry of the section shown — the same acts as the tree panel's foot, offered where the eye is. */
  emptyActions?: ReactNode;
}) {
  const l = useLabels();
  const units = l.common.units;
  return (
    <main
      className={`min-w-0 flex-1 overflow-auto p-3 sm:p-6 ${narrowHidden ? "hidden md:block" : ""}`}
    >
      {notice ? (
        <Card className="mb-4 p-4 text-sm text-muted-foreground">{notice}</Card>
      ) : null}
      {error ? (
        <Card className="p-4 text-sm text-destructive">{error}</Card>
      ) : present === false ? (
        // A real answer, not a failure: the volume is mounted but nothing is in it yet.
        <EmptyBlock actions={emptyActions}>
          {l.contents.emptyLibrary}
        </EmptyBlock>
      ) : isZone ? (
        <RecordingDays days={recordings} />
      ) : entries === null ? (
        <span role="status" aria-label={l.common.loading}>
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </span>
      ) : entries.length === 0 ? (
        <EmptyBlock actions={emptyActions}>{l.contents.emptyFamily}</EmptyBlock>
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
              <PlacementIcon
                state={serverCopy.stateOf(e.path)}
                server={serverCopy.placement?.server ?? null}
              />
              {/* A song's name is the row's keyboard way in; the row itself answers the mouse. */}
              {isSong(e) ? (
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onOpen(`${relative(e.path)}/${SONG_FILE}`);
                  }}
                >
                  {e.name}
                </button>
              ) : (
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
              )}
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
