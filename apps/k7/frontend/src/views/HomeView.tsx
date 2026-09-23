import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Calendar } from "@frediverse/ui/calendar";
import { Tabs, TabsList, TabsTrigger } from "@frediverse/ui/tabs";
import { Timeline, TimelineItem } from "@frediverse/ui/timeline";
import {
  BrushCleaning,
  Check,
  Diamond,
  Download,
  Flag,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { SongbookExport } from "../components/SongbookExport";
import { dayKey, dayKeyToDate, fmtDay, fmtTime } from "../format";
import type {
  HomeTab,
  Moment,
  Page,
  Release,
  Session,
  Song,
  SongTab,
} from "../types";

// The home tabs that share one header entry, each group drawn as a tab bar over its lists.
const TAB_GROUPS: { key: HomeTab; label: string }[][] = [
  [
    { key: "sessions", label: "Sessions" },
    { key: "moments", label: "Moments" },
  ],
  [
    { key: "releases", label: "Releases" },
    { key: "pages", label: "Pages" },
  ],
];

interface Props {
  sessions: Session[];
  releases: Release[];
  pages: Page[];
  songs: Song[];
  moments: Moment[];
  tab: HomeTab;
  /** Switch to another home tab — the tab bar of a grouped header entry. */
  onTab: (tab: HomeTab) => void;
  onOpen: (s: Session) => void;
  onDeleteSession: (id: string) => Promise<void>;
  onCleanSessions: (ids: string[]) => Promise<void>;
  onOpenRelease: (r: Release) => void;
  onNewRelease: () => void;
  onOpenPage: (p: Page) => void;
  onNewPage: () => void;
  onOpenSong: (s: Song, tab?: SongTab) => void;
  onNewSong: () => void;
  onToggleSongFavorite: (s: Song) => void;
  onOpenMoment: (m: Moment) => void;
}

export function HomeView({
  sessions,
  releases,
  pages,
  songs,
  moments,
  tab,
  onTab,
  onOpen,
  onDeleteSession,
  onCleanSessions,
  onOpenRelease,
  onNewRelease,
  onOpenPage,
  onNewPage,
  onOpenSong,
  onNewSong,
  onOpenMoment,
  onToggleSongFavorite,
}: Props) {
  const group = TAB_GROUPS.find((g) => g.some(({ key }) => key === tab));
  const [activeTag, setActiveTag] = useState<string | null>(null);
  // Which calendar day the Sessions tab is showing (null → newest day so far).
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const remove = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("Delete this session and its recording?")) return;
    await onDeleteSession(id);
  };

  // Sessions with no moments (annotations) that were recorded at least 24h ago.
  const DAY_MS = 24 * 60 * 60 * 1000;
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

  // Sessions tab: a calendar to pick a day + that day's sessions on a timeline.
  const sessionDayKeys = new Set(sessions.map((s) => dayKey(s.createdAt)));
  const todayKey = dayKey(new Date().toISOString());
  // Default to the most recent session's day (sessions arrive newest-first).
  const effectiveDay =
    selectedDay ?? (sessions[0] ? dayKey(sessions[0].createdAt) : todayKey);
  const daySessions = sessions
    .filter((s) => dayKey(s.createdAt) === effectiveDay)
    // Latest first (top of the timeline).
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const dayLabel = fmtDay(dayKeyToDate(effectiveDay).toISOString());
  const timeOfDay = (iso: string) =>
    new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

  // One timeline per tag, a multi-tagged moment under each, and a group for the untagged.
  const dateShort = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  };

  const tags = [...new Set(moments.flatMap((m) => m.tags))].sort((a, b) =>
    a.localeCompare(b),
  );
  const byRecent = (a: Moment, b: Moment) =>
    b.createdAt.localeCompare(a.createdAt);
  // The tag filter narrows to a single tag's timeline; otherwise show them all.
  const visibleTags = activeTag ? tags.filter((t) => t === activeTag) : tags;
  const tagGroups = visibleTags.map((tag) => ({
    tag,
    items: moments.filter((m) => m.tags.includes(tag)).sort(byRecent),
  }));
  const untagged = activeTag
    ? []
    : moments.filter((m) => m.tags.length === 0).sort(byRecent);

  return (
    <div>
      {/* A grouped header entry draws its tabs first; the address still says which, so each keeps its link. */}
      {group && (
        <Tabs value={tab} onValueChange={(v) => onTab(v as HomeTab)}>
          <TabsList className="mb-3.5">
            {group.map(({ key, label }) => (
              <TabsTrigger key={key} value={key}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {tab === "sessions" && (
        <>
          {sessions.length > 0 && (
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
          )}

          {sessions.length === 0 ? (
            <p className="muted small" style={{ padding: "6px 0" }}>
              No sessions yet — start a new recording from the left to get
              going.
            </p>
          ) : (
            <div className="sessions-day-view">
              <Calendar
                markedDays={sessionDayKeys}
                selected={effectiveDay}
                onSelect={setSelectedDay}
              />

              <div className="day-timeline-wrap">
                <h3 style={{ marginTop: 0 }}>{dayLabel}</h3>
                {daySessions.length === 0 ? (
                  <p className="muted small">No sessions on this day.</p>
                ) : (
                  <Timeline variant="spine" className="mt-2">
                    {daySessions.map((s) => (
                      <TimelineItem
                        key={s.id}
                        className="timeline-item"
                        time={timeOfDay(s.createdAt)}
                        onClick={() => onOpen(s)}
                      >
                        <div className="session-row">
                          <span className="session-name">
                            {s.hasRecording
                              ? fmtTime(s.duration)
                              : "No recording"}
                          </span>
                          <button
                            className="session-del"
                            title="Delete session"
                            onClick={(e) => remove(e, s.id)}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                        {(s.annotations.length > 0 || s.markers.length > 0) && (
                          <div className="session-meta">
                            {s.annotations.length > 0 && (
                              <span>
                                <Diamond className="size-3" />{" "}
                                {s.annotations.length}
                              </span>
                            )}
                            {s.markers.length > 0 && (
                              <span>
                                <Flag className="size-3" /> {s.markers.length}
                              </span>
                            )}
                          </div>
                        )}
                      </TimelineItem>
                    ))}
                  </Timeline>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {tab === "moments" && (
        <div className="moments-pane">
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
                    onClick={() => setActiveTag(activeTag === t ? null : t)}
                  >
                    #{t}
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {moments.length === 0 && (
            <p className="muted small">
              No moments yet — select a timespan in a session.
            </p>
          )}

          {[
            ...tagGroups,
            ...(untagged.length ? [{ tag: null, items: untagged }] : []),
          ].map((group) => (
            <div key={group.tag ?? "__untagged"} className="tag-timeline-group">
              <h3 className="tag-timeline-title">
                {group.tag != null ? (
                  <>#{group.tag}</>
                ) : (
                  <span className="muted">Untagged</span>
                )}{" "}
                <span className="muted small">({group.items.length})</span>
              </h3>
              <Timeline variant="spine" className="mt-2">
                {group.items.map((moment) => {
                  const otherTags = moment.tags.filter((t) => t !== group.tag);
                  return (
                    <TimelineItem
                      key={moment.id}
                      className="timeline-item"
                      validated={moment.validated}
                      time={
                        <>
                          <div>{dateShort(moment.createdAt)}</div>
                          <div className="muted">
                            {timeOfDay(moment.createdAt)}
                          </div>
                        </>
                      }
                      onClick={() => onOpenMoment(moment)}
                    >
                      <div className="session-name">
                        {moment.validated && <Check className="size-3.5" />}
                        {fmtTime(moment.startSec)}–{fmtTime(moment.endSec)}
                        {moment.text ? ` · ${moment.text}` : ""}
                      </div>
                      {(otherTags.length > 0 || !moment.sessionAvailable) && (
                        <div className="session-meta">
                          {!moment.sessionAvailable && (
                            <span>session deleted</span>
                          )}
                          {otherTags.map((t) => (
                            <Badge key={t} variant="tag">
                              #{t}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TimelineItem>
                  );
                })}
              </Timeline>
            </div>
          ))}
        </div>
      )}

      {tab === "releases" && (
        <div className="moments-pane">
          <Button variant="outline" onClick={onNewRelease}>
            <Plus className="size-4" /> New release
          </Button>
          <ul className="session-list home-list">
            {releases.length === 0 && (
              <li className="home-list-empty muted small">No releases yet.</li>
            )}
            {releases.map((r) => (
              <li
                key={r.id}
                className="session-item"
                onClick={() => onOpenRelease(r)}
              >
                <div className="session-name">{r.title}</div>
                <div className="session-meta">
                  <span>{r.artist}</span>
                  {r.canDownload && <Download className="size-3" />}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "pages" && (
        <div className="moments-pane">
          <Button variant="outline" onClick={onNewPage}>
            <Plus className="size-4" /> New page
          </Button>
          <ul className="session-list home-list">
            {pages.length === 0 && (
              <li className="home-list-empty muted small">No pages yet.</li>
            )}
            {pages.map((p) => (
              <li
                key={p.id}
                className="session-item"
                onClick={() => onOpenPage(p)}
              >
                <div className="session-name">#{p.nametag}</div>
                <div className="session-meta">
                  <span>
                    {p.releaseIds.length} release
                    {p.releaseIds.length === 1 ? "" : "s"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "songbook" && (
        <div className="moments-pane">
          <div className="songbook-actions">
            <Button variant="outline" onClick={onNewSong}>
              <Plus className="size-4" /> New song
            </Button>
            {/* The songbook is shared; what a person exports is their own favourites — ../../../docs/export.md. */}
            <SongbookExport songs={songs.filter((s) => s.favorite)} />
          </div>
          <ul className="session-list home-list">
            {songs.length === 0 && (
              <li className="home-list-empty muted small">No songs yet.</li>
            )}
            {songs.map((s) => (
              <li
                key={s.id}
                className={`session-item${s.favorite ? " favorite" : ""}`}
                onClick={() => onOpenSong(s)}
              >
                <div className="session-row">
                  <span className="session-name">{s.title}</span>
                  <button
                    className={`star-btn${s.favorite ? " on" : ""}`}
                    title={
                      s.favorite ? "Remove from favorites" : "Add to favorites"
                    }
                    aria-pressed={s.favorite}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSongFavorite(s);
                    }}
                  >
                    <Star
                      className={`size-4${s.favorite ? " fill-current" : ""}`}
                    />
                  </button>
                </div>
                <div className="session-meta">
                  <span>{s.artist}</span>
                </div>
                <div className="song-links">
                  {(
                    [
                      ["lyrics", "Lyrics"],
                      ["tablature", "Tab"],
                      ["sheet", "Sheet"],
                    ] as const
                  ).map(([key, label]) => {
                    const filled =
                      key === "sheet"
                        ? s.sheets.length > 0
                        : s[key].trim() !== "";
                    return (
                      <Button
                        key={key}
                        variant="outline"
                        size="sm"
                        className="song-link"
                        disabled={!filled}
                        title={
                          filled
                            ? `Open ${label}`
                            : `No ${label.toLowerCase()} yet`
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenSong(s, key);
                        }}
                      >
                        {label}
                      </Button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
