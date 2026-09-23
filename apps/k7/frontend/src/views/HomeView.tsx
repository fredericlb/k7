import { Button } from "@frediverse/ui/button";
import { Plus, Star } from "@frediverse/ui/icons";
import { SongbookExport } from "../components/SongbookExport";
import { m } from "../paraglide/messages.js";
import type {
  HomeTab,
  Moment,
  Page,
  Release,
  Session,
  Song,
  SongTab,
} from "../types";
import { PublicationsList } from "./PublicationsList";
import { RecordingsTimeline } from "./RecordingsTimeline";

interface Props {
  sessions: Session[];
  releases: Release[];
  pages: Page[];
  songs: Song[];
  moments: Moment[];
  tab: HomeTab;
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
  return (
    <div>
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
        <PublicationsList
          releases={releases}
          pages={pages}
          onOpenRelease={onOpenRelease}
          onNewRelease={onNewRelease}
          onOpenPage={onOpenPage}
          onNewPage={onNewPage}
        />
      )}

      {tab === "songbook" && (
        <div className="moments-pane">
          <div className="songbook-actions">
            <Button variant="outline" onClick={onNewSong}>
              <Plus className="size-4" /> {m["songbook.new"]()}
            </Button>
            {/* The songbook is shared; what a person exports is their own favourites — ../../../docs/export.md. */}
            <SongbookExport songs={songs.filter((s) => s.favorite)} />
          </div>
          <ul className="session-list home-list">
            {songs.length === 0 && (
              <li className="home-list-empty muted small">
                {m["songbook.empty"]()}
              </li>
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
                      s.favorite ? m["song.unfavorite"]() : m["song.favorite"]()
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
                      [
                        "lyrics",
                        m["song.tab.lyrics"],
                        m["songbook.open.lyrics"],
                        m["songbook.none.lyrics"],
                      ],
                      [
                        "tablature",
                        m["song.tab.tablature"],
                        m["songbook.open.tablature"],
                        m["songbook.none.tablature"],
                      ],
                      [
                        "sheet",
                        m["song.tab.sheet"],
                        m["songbook.open.sheet"],
                        m["songbook.none.sheet"],
                      ],
                    ] as const
                  ).map(([key, label, open, none]) => {
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
                        title={filled ? open() : none()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenSong(s, key);
                        }}
                      >
                        {label()}
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
