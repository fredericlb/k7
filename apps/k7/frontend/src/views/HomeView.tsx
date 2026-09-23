import { Button } from "@frediverse/ui/button";
import { Download, Plus, Star } from "@frediverse/ui/icons";
import { Tabs, TabsList, TabsTrigger } from "@frediverse/ui/tabs";
import { SongbookExport } from "../components/SongbookExport";
import type {
  HomeTab,
  Moment,
  Page,
  Release,
  Session,
  Song,
  SongTab,
} from "../types";
import { RecordingsTimeline } from "./RecordingsTimeline";

// The home tabs that share one header entry, each group drawn as a tab bar over its lists.
const TAB_GROUPS: { key: HomeTab; label: string }[][] = [
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
        <RecordingsTimeline
          sessions={sessions}
          moments={moments}
          onOpen={onOpen}
          onOpenMoment={onOpenMoment}
          onDeleteSession={onDeleteSession}
        />
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
