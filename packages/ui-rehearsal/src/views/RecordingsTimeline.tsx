// RecordingsTimeline.tsx — sessions and their moments on one day timeline, filterable by tag.
// A moment hangs indented under its session; an orphan (its session deleted) stands at the
// session level, placed by when it was made. Why one list and not two tabs: ../../docs/recordings.md.

import { Badge } from "@frediverse/ui/badge";
import { Calendar } from "@frediverse/ui/calendar";
import { Check, Diamond, Flag, Mic, Trash2 } from "@frediverse/ui/icons";
import { Timeline, TimelineItem } from "@frediverse/ui/timeline";
import { useState } from "react";
import {
  MomentStateIcon,
  type useMomentShare,
} from "../components/MomentServerShare";
import { confirmLoss } from "../confirm";
import { dayKey, dayKeyToDate, fmtDay, fmtTime } from "../format";
import { locale } from "../i18n";
import { m } from "../paraglide/messages.js";
import { StartFirstSessionButton } from "../recording/NewSessionButton";
import type { Moment, Session } from "../types";

interface Props {
  sessions: Session[];
  moments: Moment[];
  onOpen: (s: Session) => void;
  onOpenMoment: (m: Moment) => void;
  onDeleteSession: (id: string) => Promise<void>;
  /** Where each moment lives on a machine paired with a server; absent, nothing is drawn. */
  share?: ReturnType<typeof useMomentShare>;
}

// One row of the day: a session with the moments shown under it, or an orphan moment.
export type Entry =
  | { kind: "session"; at: string; session: Session; moments: Moment[] }
  | { kind: "orphan"; at: string; moment: Moment };

/** Sessions with their moments (by offset) and orphan moments, newest first, narrowed to a tag. */
export function buildEntries(
  sessions: Session[],
  moments: Moment[],
  tag: string | null,
): Entry[] {
  const matches = (m: Moment) => !tag || m.tags.includes(tag);
  const sessionIds = new Set(sessions.map((s) => s.id));
  const bySession = new Map<string, Moment[]>();
  for (const m of moments) {
    if (!m.sessionUid || !sessionIds.has(m.sessionUid)) continue;
    const list = bySession.get(m.sessionUid) ?? [];
    list.push(m);
    bySession.set(m.sessionUid, list);
  }
  // With a tag set, a session stays when one of its moments carries it, and only those show under it.
  const withSessions = sessions.flatMap((session): Entry[] => {
    const own = (bySession.get(session.id) ?? [])
      .filter(matches)
      .sort((a, b) => a.startSec - b.startSec);
    if (tag && own.length === 0) return [];
    return [{ kind: "session", at: session.createdAt, session, moments: own }];
  });
  const orphans = moments
    .filter(
      (m) => !(m.sessionUid && sessionIds.has(m.sessionUid)) && matches(m),
    )
    .map((moment): Entry => ({ kind: "orphan", at: moment.createdAt, moment }));
  return [...withSessions, ...orphans].sort((a, b) => b.at.localeCompare(a.at));
}

const timeOfDay = (iso: string) =>
  new Date(iso).toLocaleTimeString(locale(), {
    hour: "2-digit",
    minute: "2-digit",
  });

// A moment's wall-clock time: its session's start plus its offset into the take.
const momentClock = (s: Session, m: Moment) =>
  timeOfDay(
    new Date(new Date(s.createdAt).getTime() + m.startSec * 1000).toISOString(),
  );

export function RecordingsTimeline({
  sessions,
  moments,
  onOpen,
  onOpenMoment,
  onDeleteSession,
  share,
}: Props) {
  const [activeTag, setActiveTag] = useState<string | null>(null);
  // Which calendar day is shown (null → the newest day with something to show).
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const tags = [...new Set(moments.flatMap((m) => m.tags))].sort((a, b) =>
    a.localeCompare(b),
  );
  const entries = buildEntries(sessions, moments, activeTag);

  const markedDays = new Set(entries.map((e) => dayKey(e.at)));
  const effectiveDay =
    selectedDay ??
    (entries[0] ? dayKey(entries[0].at) : dayKey(new Date().toISOString()));
  const dayEntries = entries.filter((e) => dayKey(e.at) === effectiveDay);

  const remove = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!(await confirmLoss(m["session.confirmDelete"]()))) return;
    await onDeleteSession(id);
  };

  // A new filter lands on its newest match rather than on a day it may have emptied.
  const pickTag = (t: string) => {
    setActiveTag(activeTag === t ? null : t);
    setSelectedDay(null);
  };

  const momentItem = (mo: Moment, time: string, child: boolean) => (
    <TimelineItem
      key={mo.id}
      className={`timeline-item${child ? " moment-child" : ""}`}
      validated={mo.validated}
      time={time}
      activatable
      onClick={() => onOpenMoment(mo)}
    >
      <div className="session-name">
        <MomentStateIcon
          state={share?.stateOf(mo.id) ?? null}
          host={share?.host ?? ""}
        />
        {mo.validated && <Check className="size-3.5" />}
        {fmtTime(mo.startSec)}–{fmtTime(mo.endSec)}
        {mo.text ? ` · ${mo.text}` : ""}
      </div>
      {(mo.tags.length > 0 || !child) && (
        <div className="session-meta">
          {!child && <span>{m["moment.sessionDeleted"]()}</span>}
          {mo.tags.map((t) => (
            <Badge key={t} variant="tag">
              #{t}
            </Badge>
          ))}
        </div>
      )}
    </TimelineItem>
  );

  if (sessions.length === 0 && moments.length === 0) {
    // The act on the spot, as k7's own empty pages offer theirs (apps/k7/frontend/src/projects/EmptyState.tsx); a div, the wrapper's `p` margins being unlayered.
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center">
        <Mic className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <div className="max-w-md text-muted-foreground text-sm">
          {m["recordings.empty"]()}
        </div>
        <StartFirstSessionButton />
      </div>
    );
  }

  return (
    <>
      <div className="sessions-day-view">
        {/* The filters sit under the calendar: both choose what the timeline beside them shows. */}
        <div className="calendar-col">
          <Calendar
            disableFuture
            markedDays={markedDays}
            selected={effectiveDay}
            onSelect={setSelectedDay}
          />
          {tags.length > 0 && (
            <div className="row tag-chips moment-filter">
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
        </div>

        <div className="day-timeline-wrap">
          <h3 style={{ marginTop: 0 }}>
            {fmtDay(dayKeyToDate(effectiveDay).toISOString())}
          </h3>
          {dayEntries.length === 0 ? (
            <p className="muted small">
              {activeTag
                ? m["recordings.noneTagged"]({ tag: activeTag })
                : m["recordings.noneThisDay"]()}
            </p>
          ) : (
            <Timeline variant="spine" className="mt-2">
              {dayEntries.flatMap((e) =>
                e.kind === "orphan"
                  ? [momentItem(e.moment, timeOfDay(e.at), false)]
                  : [
                      <TimelineItem
                        key={e.session.id}
                        className="timeline-item"
                        time={timeOfDay(e.at)}
                        activatable
                        onClick={() => onOpen(e.session)}
                      >
                        <div className="session-row">
                          <span className="session-name">
                            {e.session.hasRecording
                              ? fmtTime(e.session.duration)
                              : m["session.noRecording"]()}
                          </span>
                          <button
                            type="button"
                            className="session-del"
                            title={m["session.delete"]()}
                            aria-label={m["session.delete"]()}
                            onClick={(ev) => remove(ev, e.session.id)}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                        {(e.session.annotations.length > 0 ||
                          e.session.markers.length > 0) && (
                          <div className="session-meta">
                            {e.session.annotations.length > 0 && (
                              <span>
                                <Diamond className="size-3" />{" "}
                                {e.session.annotations.length}
                              </span>
                            )}
                            {e.session.markers.length > 0 && (
                              <span>
                                <Flag className="size-3" />{" "}
                                {e.session.markers.length}
                              </span>
                            )}
                          </div>
                        )}
                      </TimelineItem>,
                      ...e.moments.map((mo) =>
                        momentItem(mo, momentClock(e.session, mo), true),
                      ),
                    ],
              )}
            </Timeline>
          )}
        </div>
      </div>
    </>
  );
}
