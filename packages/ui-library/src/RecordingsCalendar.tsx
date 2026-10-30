// RecordingsCalendar.tsx — the capture zone's screen: a calendar to pick a day, and that day's captures
// on a timeline, each at the time it started, with the account's moments indented under it.
// The same screen the rehearsal sessions have, for the same reason: ../docs/recordings.md.

import { Badge } from "@frediverse/ui/badge";
import { Calendar, dayKey } from "@frediverse/ui/calendar";
import { Card } from "@frediverse/ui/card";
import { Check } from "@frediverse/ui/icons";
import { Timeline, TimelineItem } from "@frediverse/ui/timeline";
import type { RecordingDay } from "@studio/mediatek/recordings";
import type { Moment } from "@studio/rehearsal-shared";
import { type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { library } from "./api";
import { useLabels, useLibraryHost } from "./host";
import { bytes } from "./libraryTree";
import { captureEntries, captureTags } from "./recordingCalendar";

const clock = (locale: string, at: Date, seconds = false) =>
  at.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
  });

// A span of the capture, as the rehearsal pages print one.
const span = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function RecordingsCalendar({
  days,
  error,
  notice,
  addButton,
  empty,
}: {
  days: RecordingDay[];
  error: string | null;
  notice: string | null;
  /** What files a capture by hand, under the calendar. */
  addButton: ReactNode;
  /** What stands in the place of an empty zone. */
  empty: ReactNode;
}) {
  const l = useLabels();
  const { recordingHref, momentHref } = useLibraryHost();
  const navigate = useNavigate();
  const [moments, setMoments] = useState<Moment[]>([]);
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
    return () => {
      alive = false;
    };
  }, [days]);

  if (error)
    return <Card className="p-4 text-sm text-destructive">{error}</Card>;
  if (days.length === 0) return <>{empty}</>;

  const tags = captureTags(days, moments);
  const entries = captureEntries(days, moments, activeTag);
  const markedDays = new Set(entries.map((e) => e.day));
  const shownDay = selectedDay ?? entries[0]?.day ?? dayKey(new Date());
  const dayEntries = entries.filter((e) => e.day === shownDay);
  const [y, mo, d] = shownDay.split("-").map(Number);

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
        {addButton}
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
                <div className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate font-mono text-sm tabular-nums">
                    {e.file.name}
                  </span>
                  <span className="shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
                    {bytes(e.file.bytes, l.common.units)}
                  </span>
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
