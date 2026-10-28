import { useMomentShare } from "../components/MomentServerShare";
import { ServerOnly } from "../components/ServerOnly";
import type { HomeTab, Moment, Page, Release, Session } from "../types";
import { PublicationsList } from "./PublicationsList";
import { RecordingsTimeline } from "./RecordingsTimeline";

interface Props {
  sessions: Session[];
  releases: Release[];
  pages: Page[];
  moments: Moment[];
  tab: HomeTab;
  onOpen: (s: Session) => void;
  onDeleteSession: (id: string) => Promise<void>;
  onOpenRelease: (r: Release) => void;
  onNewRelease: () => void;
  onOpenPage: (p: Page) => void;
  onNewPage: () => void;
  /** Called when the server holding releases and pages is found reachable, to load them. */
  onPublicationsReachable: () => void;
  onOpenMoment: (m: Moment) => void;
}

export function HomeView({
  sessions,
  releases,
  pages,
  moments,
  tab,
  onOpen,
  onDeleteSession,
  onOpenRelease,
  onNewRelease,
  onOpenPage,
  onNewPage,
  onOpenMoment,
  onPublicationsReachable,
}: Props) {
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
    </div>
  );
}
