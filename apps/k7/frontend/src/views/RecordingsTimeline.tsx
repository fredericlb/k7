// RecordingsTimeline.tsx — sessions and their moments on one day timeline, filterable by tag.
// A moment hangs indented under its session; an orphan (its session deleted) stands at the
// session level, placed by when it was made. Why one list and not two tabs: ../../../docs/recordings.md.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Calendar } from "@frediverse/ui/calendar";
import {
  BrushCleaning,
  Check,
  Diamond,
  Flag,
  Trash2,
} from "@frediverse/ui/icons";
import { Timeline, TimelineItem } from "@frediverse/ui/timeline";
import { useState } from "react";
import { dayKey, dayKeyToDate, fmtDay, fmtTime } from "../format";
import type { Moment, Session } from "../types";

interface Props {
  sessions: Session[];
  moments: Moment[];
  onOpen: (s: Session) => void;
  onOpenMoment: (m: Moment) => void;
  onDeleteSession: (id: string) => Promise<void>;
  onCleanSessions: (ids: string[]) => Promise<void>;
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

const DAY_MS = 24 * 60 * 60 * 1000;

const timeOfDay = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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
  onCleanSessions,
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

  // Sessions with no moments that were recorded at least 24h ago.
  const staleSessions = sessions.filter(
    (s) =>
      s.annotations.length === 0 &&
      Date.now() - new Date(s.createdAt).getTime() >= DAY_MS,
  );

  const clean = async () => {
    const n = staleSessions.length;
    if (n === 0) return;
    if (
      !confirm(
        `Delete ${n} empty session${n === 1 ? "" : "s"} with no moments, ` +
          `recorded over 24h ago?`,
      )
    )
      return;
    await onCleanSessions(staleSessions.map((s) => s.id));
  };

  const remove = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("Delete this session and its recording?")) return;
    await onDeleteSession(id);
  };

  // A new filter lands on its newest match rather than on a day it may have emptied.
  const pickTag = (t: string) => {
    setActiveTag(activeTag === t ? null : t);
    setSelectedDay(null);
  };

  const momentItem = (m: Moment, time: string, child: boolean) => (
    <TimelineItem
      key={m.id}
      className={`timeline-item${child ? " moment-child" : ""}`}
      validated={m.validated}
      time={time}
      onClick={() => onOpenMoment(m)}
    >
      <div className="session-name">
        {m.validated && <Check className="size-3.5" />}
        {fmtTime(m.startSec)}–{fmtTime(m.endSec)}
        {m.text ? ` · ${m.text}` : ""}
      </div>
      {(m.tags.length > 0 || !child) && (
        <div className="session-meta">
          {!child && <span>session deleted</span>}
          {m.tags.map((t) => (
            <Badge key={t} variant="tag">
              #{t}
            </Badge>
          ))}
        </div>
      )}
    </TimelineItem>
  );

  if (sessions.length === 0 && moments.length === 0) {
    return (
      <p className="muted small" style={{ padding: "6px 0" }}>
        No sessions yet — start a new recording from the header to get going.
      </p>
    );
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <Button
          variant="outline"
          size="sm"
          onClick={clean}
          disabled={staleSessions.length === 0}
          title="Delete empty sessions (no moments) recorded over 24h ago"
        >
          <BrushCleaning className="size-4" /> Clean up{" "}
          {staleSessions.length > 0 ? `${staleSessions.length} ` : ""}
          empty session{staleSessions.length === 1 ? "" : "s"}
        </Button>
      </div>

      {tags.length > 0 && (
        <div
          className="row tag-chips moment-filter"
          style={{ marginBottom: 12 }}
        >
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

      <div className="sessions-day-view">
        <Calendar
          markedDays={markedDays}
          selected={effectiveDay}
          onSelect={setSelectedDay}
        />

        <div className="day-timeline-wrap">
          <h3 style={{ marginTop: 0 }}>
            {fmtDay(dayKeyToDate(effectiveDay).toISOString())}
          </h3>
          {dayEntries.length === 0 ? (
            <p className="muted small">
              {activeTag
                ? `Nothing tagged #${activeTag} on this day.`
                : "No sessions on this day."}
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
                        onClick={() => onOpen(e.session)}
                      >
                        <div className="session-row">
                          <span className="session-name">
                            {e.session.hasRecording
                              ? fmtTime(e.session.duration)
                              : "No recording"}
                          </span>
                          <button
                            type="button"
                            className="session-del"
                            title="Delete session"
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
                      ...e.moments.map((m) =>
                        momentItem(m, momentClock(e.session, m), true),
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
