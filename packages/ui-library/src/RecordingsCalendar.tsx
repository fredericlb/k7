// RecordingsCalendar.tsx — the capture zone's screen: a calendar to pick a day, and that day's captures
// on a timeline, each at the time it started, with the account's moments indented under it.
// It is where the takes are listed, a session's included: ../docs/recordings.md.

import { Badge } from "@frediverse/ui/badge";
import { Calendar, dayKey } from "@frediverse/ui/calendar";
import { Card } from "@frediverse/ui/card";
import { Check, CloudCheck, HardDrive, Mic } from "@frediverse/ui/icons";
import { Timeline, TimelineItem } from "@frediverse/ui/timeline";
import type { RecordingDay } from "@studio/mediatek/recordings";
import type {
  Moment,
  MomentPlacement,
  Session,
} from "@studio/rehearsal-shared";
import { type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { library } from "./api";
import { useCaptureSeconds } from "./captureSeconds";
import { useLabels, useLibraryHost } from "./host";
import { bytes } from "./libraryTree";
import { RowMenu, rowTarget } from "./RowMenu";
import { captureEntries, captureTags } from "./recordingCalendar";

const clock = (locale: string, at: Date, seconds = false) =>
  at.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
  });

// A span or a duration, as the rehearsal pages print one.
const span = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function RecordingsCalendar({
  days,
  error,
  notice,
  manage,
  onChanged,
  onError,
  addButton,
  empty,
}: {
  days: RecordingDay[];
  error: string | null;
  notice: string | null;
  /** An admin's: any capture may be deleted, not only the reader's own takes. */
  manage: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
  /** What files a capture by hand, under the calendar. */
  addButton: ReactNode;
  /** What stands in the place of an empty zone. */
  empty: ReactNode;
}) {
  const l = useLabels();
  const { recordingHref, momentHref, recordButton } = useLibraryHost();
  const navigate = useNavigate();
  const [moments, setMoments] = useState<Moment[]>([]);
  // The reader's own takes, by the capture each filed: a duration to show, and a delete of their own.
  const [takes, setTakes] = useState<Map<string, Session>>(new Map());
  // Which moments the paired server holds a copy of; null off a paired machine, which shows no icon.
  const [placement, setPlacement] = useState<MomentPlacement | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  // Which calendar day is shown (null → the newest day with something to show).
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Read again whenever the zone moved; a backend without the rehearsal store shows the captures alone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `days` is the trigger, a new listing being a zone that moved
  useEffect(() => {
    let alive = true;
    library
      .moments()
      .then((got) => alive && setMoments(got))
      .catch(() => alive && setMoments([]));
    library
      .mySessions()
      .then(
        (got) =>
          alive &&
          setTakes(
            new Map(
              got.flatMap((x) =>
                x.recordingPath ? [[x.recordingPath, x]] : [],
              ),
            ),
          ),
      )
      .catch(() => alive && setTakes(new Map()));
    library
      .momentPlacement()
      .then((p) => alive && setPlacement(p.paired ? p : null))
      .catch(() => alive && setPlacement(null));
    return () => {
      alive = false;
    };
  }, [days]);

  const tags = captureTags(days, moments);
  const entries = captureEntries(days, moments, activeTag);
  const markedDays = new Set(entries.map((e) => e.day));
  const shownDay = selectedDay ?? entries[0]?.day ?? dayKey(new Date());
  const dayEntries = entries.filter((e) => e.day === shownDay);
  const [y, mo, d] = shownDay.split("-").map(Number);
  // A take is timed by its session; any other capture of the day shown is measured (captureSeconds.ts).
  const seconds = useCaptureSeconds(
    dayEntries.filter((e) => !takes.has(e.file.path)).map((e) => e.file.path),
  );
  const durationOf = (path: string): number | null | undefined =>
    takes.get(path)?.duration ?? seconds.get(path);
  const shared = new Set(placement?.shared ?? []);
  const serverHost = placement?.server ? new URL(placement.server).host : "";

  if (error)
    return <Card className="p-4 text-sm text-destructive">{error}</Card>;
  if (days.length === 0) return <>{empty}</>;

  // A take goes with its session, its owner's to delete; any other capture is an admin's (../docs/recordings.md).
  const remove = (path: string) => {
    void library
      .deleteRecording(path)
      .then(onChanged)
      .catch((e: Error) => onError(e.message));
  };
  const deleteAction = {
    key: "delete-recording",
    label: l.contents.deleteRecording,
    danger: true,
    when: (t: { path: string }) => manage || takes.has(t.path),
    confirm: {
      message: (t: { name: string }) =>
        l.contents.deleteRecordingConfirm(t.name),
      submit: l.tree.deleteSubmit,
    },
    run: (t: { path: string }) => remove(t.path),
  };

  // A new filter lands on its newest match rather than on a day it may have emptied.
  const pickTag = (t: string) => {
    setActiveTag(activeTag === t ? null : t);
    setSelectedDay(null);
  };

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <div className="flex shrink-0 flex-col gap-3 md:w-[290px]">
        <Calendar
          disableFuture
          markedDays={markedDays}
          selected={shownDay}
          onSelect={setSelectedDay}
        />
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <Badge
                key={t}
                variant="tag"
                asChild
                className={
                  activeTag === t
                    ? "border-primary bg-primary text-white"
                    : undefined
                }
              >
                <button
                  type="button"
                  aria-pressed={activeTag === t}
                  onClick={() => pickTag(t)}
                >
                  #{t}
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {recordButton}
          {addButton}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {notice ? (
          <Card className="mb-4 p-4 text-sm text-muted-foreground">
            {notice}
          </Card>
        ) : null}
        <h2 className="mb-2 font-semibold text-sm">
          {new Date(y, mo, d).toLocaleDateString(l.common.locale, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </h2>
        {dayEntries.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {activeTag
              ? l.contents.noneTagged(activeTag)
              : l.contents.noneThisDay}
          </p>
        ) : (
          <Timeline variant="spine">
            {dayEntries.flatMap((e) => [
              <TimelineItem
                key={e.file.path}
                time={clock(l.common.locale, e.at, true)}
                activatable={!!recordingHref}
                onClick={
                  recordingHref
                    ? () => navigate(recordingHref(e.file.path))
                    : undefined
                }
              >
                <div className="flex items-center gap-3">
                  {takes.has(e.file.path) && (
                    <Mic
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-label={l.contents.yourTake}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-sm tabular-nums">
                    {e.file.name}
                  </span>
                  {/* Its duration once known; its size until then, or for good when it cannot be measured. */}
                  <span className="shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
                    {durationOf(e.file.path) != null
                      ? span(durationOf(e.file.path) ?? 0)
                      : bytes(e.file.bytes, l.common.units)}
                  </span>
                  <RowMenu
                    target={rowTarget(e.file.path, e.file.name)}
                    actions={[deleteAction]}
                    label={l.tree.more}
                    cancelLabel={l.common.cancel}
                  />
                </div>
              </TimelineItem>,
              ...e.moments.map((m) => (
                <TimelineItem
                  key={m.id}
                  className="ml-6"
                  validated={m.validated}
                  time={clock(
                    l.common.locale,
                    new Date(e.at.getTime() + m.startSec * 1000),
                  )}
                  activatable={!!momentHref}
                  onClick={
                    momentHref ? () => navigate(momentHref(m.id)) : undefined
                  }
                >
                  <div className="flex items-center gap-1 text-sm">
                    {placement && (
                      <span
                        role="img"
                        title={
                          shared.has(m.id)
                            ? l.contents.momentShared(serverHost)
                            : l.contents.momentLocal
                        }
                        aria-label={
                          shared.has(m.id)
                            ? l.contents.momentShared(serverHost)
                            : l.contents.momentLocal
                        }
                      >
                        {shared.has(m.id) ? (
                          <CloudCheck className="size-3.5 text-primary" />
                        ) : (
                          <HardDrive className="size-3.5 text-muted-foreground" />
                        )}
                      </span>
                    )}
                    {m.validated && <Check className="size-3.5" />}
                    {span(m.startSec)}–{span(m.endSec)}
                    {m.text ? ` · ${m.text}` : ""}
                  </div>
                  {m.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {m.tags.map((t) => (
                        <Badge key={t} variant="tag">
                          #{t}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TimelineItem>
              )),
            ])}
          </Timeline>
        )}
      </div>
    </div>
  );
}
