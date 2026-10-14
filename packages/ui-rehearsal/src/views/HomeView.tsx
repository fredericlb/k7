import { AddFab } from "../components/AddFab";
import { useMomentShare } from "../components/MomentServerShare";
import { ServerOnly } from "../components/ServerOnly";
import { SongbookExport } from "../components/SongbookExport";
import {
  ServerOnlySongs,
  useSongbookCopy,
} from "../components/SongbookServerCopy";
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
  /** Called once a song came down from the paired server, to reload the list. */
  onSongsChanged: () => void;
  /** Called when the server holding releases and pages is found reachable, to load them. */
  onPublicationsReachable: () => void;
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
  onSongsChanged,
  onPublicationsReachable,
}: Props) {
  // Where each song lives on a machine paired with a server — ../../../rehearsal-server/docs/songbookCopy.md.
  const copy = useSongbookCopy(songs, onSongsChanged, tab === "songbook");
  // Which moments the paired server holds; a session never leaves this machine — ../../../rehearsal-server/docs/momentShare.md.
  const share = useMomentShare(tab === "sessions", moments);
  return (
    <div>
      {tab === "sessions" && (
        <RecordingsTimeline
          sessions={sessions}
          moments={moments}
          onOpen={onOpen}
          onOpenMoment={onOpenMoment}
          onDeleteSession={onDeleteSession}
          share={share}
        />
      )}

      {tab === "releases" && (
        // Releases and pages are the server's alone — ../../../rehearsal-server/docs/publications.md.
        <ServerOnly onAvailable={onPublicationsReachable}>
          <PublicationsList
            releases={releases}
            pages={pages}
            onOpenRelease={onOpenRelease}
            onNewRelease={onNewRelease}
            onOpenPage={onOpenPage}
            onNewPage={onNewPage}
          />
        </ServerOnly>
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
            copy={copy}
            onOpenSong={onOpenSong}
            onToggleSongFavorite={onToggleSongFavorite}
          />
          <ServerOnlySongs copy={copy} />
        </div>
      )}
    </div>
  );
}
