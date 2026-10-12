import { AddFab } from "../components/AddFab";
import { SongbookExport } from "../components/SongbookExport";
import { SongbookTable } from "../components/SongbookTable";
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
          <AddFab
            actions={[{ label: m["songbook.new"](), onSelect: onNewSong }]}
          />
          <SongbookTable
            songs={songs}
            // The songbook is shared; what a person exports is their own favourites — ../../docs/export.md.
            headerMenu={
              <SongbookExport songs={songs.filter((s) => s.favorite)} />
            }
            onOpenSong={onOpenSong}
            onToggleSongFavorite={onToggleSongFavorite}
          />
        </div>
      )}
    </div>
  );
}
