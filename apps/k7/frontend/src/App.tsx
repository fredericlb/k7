import { ChevronDown, Workflow } from "@frediverse/ui/icons";
import {
  acquireMicrophone,
  describeMicError,
  RecorderView,
} from "@k7/recorder";
import { useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api } from "./api";
import { signIn, signInLooped, signInSettled } from "./auth";
import { ChainSourcePanel } from "./components/ChainSourcePanel";
import { RecoveredTakes } from "./components/RecoveredTakes";
import { SessionSourceDialog } from "./components/SessionSourceDialog";
import { MomentDetailContainer } from "./containers/MomentDetailContainer";
import { PageDetailContainer } from "./containers/PageDetailContainer";
import { ReleaseDetailContainer } from "./containers/ReleaseDetailContainer";
import { SessionDetailContainer } from "./containers/SessionDetailContainer";
import { SongDetailContainer } from "./containers/SongDetailContainer";
import { fmtStamp } from "./format";
import { m } from "./paraglide/messages.js";
import { micErrors, recorderLabels } from "./recorderLabels";
import { connectRemoteMic } from "./rtc";
import type {
  Envelope,
  HomeTab,
  Moment,
  NavKey,
  Page,
  Release,
  Session,
  Song,
  SongTab,
  User,
} from "./types";
import { ExercisesView } from "./views/ExercisesView";
import { GuitarTuner } from "./views/GuitarTuner";
import { HeaderView } from "./views/HeaderView";
import { HomeView } from "./views/HomeView";
import { LoginView } from "./views/LoginView";
import { PageFormView } from "./views/PageFormView";
import { RandomChordsExercise } from "./views/RandomChordsExercise";
import { ReleaseFormView } from "./views/ReleaseFormView";
import { RemoteMicView } from "./views/RemoteMicView";
import { SettingsView } from "./views/SettingsView";
import { SingingExercisesView } from "./views/SingingExercisesView";
import { SongFormView } from "./views/SongFormView";

// The in-progress recording, independent of the route so the app stays browsable while it runs.
interface RecordingCtx {
  session: Session;
  stream: MediaStream;
  // Seconds already recorded; its presence means "append to the existing take".
  resumeFrom?: number;
  // The saved recording's envelope, shown as history behind the new take.
  baseEnvelope?: Envelope;
  // Present for a stream that needs tearing down: the WebRTC connection, or the chain's listener.
  rtc?: { close: () => void };
  // Recorded through a chain of st0's library, whose panel stays mounted for the take.
  chain?: boolean;
}

// The `songbook` tab lives at `/songs`, and a grouped entry opens on its first tab; the rest map to their own name.
const TAB_TO_PATH: Record<NavKey, string> = {
  recordings: "sessions",
  publications: "releases",
  songbook: "songs",
  exercices: "exercices",
};

function tabPath(tab: NavKey): string {
  return `/${TAB_TO_PATH[tab]}`;
}

// The home list routes, each with the HomeView tab it selects.
const HOME_ROUTES: { path: string; tab: HomeTab }[] = [
  { path: "sessions", tab: "sessions" },
  { path: "releases", tab: "releases" },
  { path: "songs", tab: "songbook" },
];

// One song's own page: the songbook list and the creation form are not it.
function isSongPage(pathname: string): boolean {
  return /^\/songs\/(?!new$)[^/]+$/.test(pathname);
}

// Derive which nav item is highlighted from the current pathname.
function navForPath(pathname: string): NavKey | "settings" {
  const seg = pathname.split("/")[1] ?? "";
  // Releases and pages are the two tabs of one entry, detail screens included.
  if (seg === "releases" || seg === "pages") return "publications";
  if (seg === "songs") return "songbook";
  if (seg === "exercices") return "exercices";
  // Not an entry: the gear in the bar's actions lights up instead.
  if (seg === "settings") return "settings";
  // sessions, moments, record, and everything else fall back to Recordings.
  return "recordings";
}

// --- Route wrappers -------------------------------------------------------

// Each reads the URL params and forwards them to a container that reloads on an id change.
function SessionRoute(props: {
  allTags: string[];
  onBack: () => void;
  onChange: () => void;
  onResume: (session: Session) => Promise<void>;
}) {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const t = sp.get("t");
  return (
    <SessionDetailContainer
      key={id}
      sessionId={id!}
      seekTo={t != null ? Number(t) : undefined}
      {...props}
    />
  );
}

function ReleaseRoute(props: {
  onDeleted: () => void;
  onChange: () => void;
  onBack: () => void;
}) {
  const { id } = useParams();
  return <ReleaseDetailContainer key={id} releaseId={id!} {...props} />;
}

function PageRoute(props: {
  allReleases: Release[];
  onChange: () => void;
  onDeleted: () => void;
  onBack: () => void;
}) {
  const { id } = useParams();
  return <PageDetailContainer key={id} pageId={id!} {...props} />;
}

function SongRoute(props: {
  onChange: () => void;
  onDeleted: () => void;
  onBack: () => void;
}) {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const tab = sp.get("tab") as SongTab | null;
  return (
    <SongDetailContainer
      key={id}
      songId={id!}
      initialTab={tab ?? undefined}
      {...props}
    />
  );
}

function MomentRoute(props: {
  onBack: () => void;
  onDeleted: () => void;
  onOpenSession: (sessionUid: string, seekTo?: number) => void;
}) {
  const { id } = useParams();
  return <MomentDetailContainer key={id} momentId={id!} {...props} />;
}

// Every track of a stream nothing will record — what turns the microphone light off.
function stopTracks(stream: MediaStream): void {
  for (const t of stream.getTracks()) t.stop();
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [recording, setRecording] = useState<RecordingCtx | null>(null);
  // The running take drawn in its pop-in; false collapses it to the bottom bar.
  const [recOpen, setRecOpen] = useState(false);
  useEffect(() => {
    if (!recOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setRecOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recOpen]);
  // "New session" source chooser (this device's mic vs. a remote device).
  const [sourceOpen, setSourceOpen] = useState(false);
  const [remoteAvailable, setRemoteAvailable] = useState<boolean | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  // The chain source's panel: mounted from the choice to the end of the take, drawn while `chainShown`.
  const [chainOpen, setChainOpen] = useState(false);
  const [chainShown, setChainShown] = useState(false);

  const refresh = () => api.listSessions().then(setSessions);
  const refreshReleases = () => api.listReleases().then(setReleases);
  const refreshPages = () => api.listPages().then(setPages);
  const refreshSongs = () => api.listSongs().then(setSongs);
  const refreshMoments = () => api.listMoments().then(setMoments);
  // A session edit moves the standalone moments list too, so both refresh together.
  const refreshSessions = () => {
    refresh();
    refreshMoments();
  };

  // No sign-in screen of our own: anonymous leaves for the origin root's /auth/login — see auth.ts.
  useEffect(() => {
    api
      .getMe()
      .then((u) => {
        if (u) {
          signInSettled();
          setUser(u);
        } else if (!signInLooped()) {
          signIn();
          return; // the page is navigating away; leave it on "Loading…"
        }
        setAuthChecked(true);
      })
      .catch(() => {
        // A real failure (network, the auth backend down), not a 401 — logging in won't fix it.
        setUser(null);
        setAuthChecked(true);
      });
  }, []);

  // Keep probing while the chooser is open, so the option enables as soon as a device connects.
  useEffect(() => {
    if (!sourceOpen) return;
    let alive = true;
    const check = () =>
      api
        .rtcRemoteStatus()
        .then((r) => alive && setRemoteAvailable(r.connected))
        .catch(() => alive && setRemoteAvailable(false));
    check();
    const id = setInterval(check, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [sourceOpen]);

  useEffect(() => {
    if (user) {
      refresh();
      refreshReleases();
      refreshPages();
      refreshSongs();
      refreshMoments();
    }
  }, [user]);

  const logout = async () => {
    await api.logout();
    setRecording(null);
    // Leave for the origin's home: staying here would bounce straight back into signing in.
    window.location.href = "/";
  };

  const handleStartSession = async () => {
    // Only one recording at a time — bring the user back to the active one.
    if (recording) {
      setRecOpen(true);
      throw new Error(m["rec.finishFirst"]());
    }
    // Ask where the audio should come from; the effect above probes while this is open.
    setSourceError(null);
    setRemoteAvailable(null);
    setSourceOpen(true);
  };

  // Create the session once we have a stream, and open the recorder unless a song holds the page.
  const beginSession = async (
    stream: MediaStream,
    rtc?: { close: () => void },
    chain?: boolean,
  ) => {
    // Sessions have no name — they're identified by their recording date/time.
    const s = await api.createSession();
    // The session exists from here: a failed list refresh must not cost the take about to start.
    await refresh().catch((err: unknown) => console.error(err));
    setRecording({ session: s, stream, rtc, chain });
    setSourceOpen(false);
    // A take started on a song stays there, collapsed to the bar — ../../docs/audio.md.
    setRecOpen(!isSongPage(location.pathname));
  };

  const startLocalSession = async () => {
    setSourceBusy(true);
    setSourceError(null);
    try {
      const stream = await acquireMicrophone();
      try {
        await beginSession(stream);
      } catch (err) {
        stopTracks(stream); // the session never started — the microphone must not stay on
        throw err;
      }
    } catch (err) {
      setSourceError(describeMicError(err, micErrors()));
    } finally {
      setSourceBusy(false);
    }
  };

  const startRemoteSession = async () => {
    setSourceBusy(true);
    setSourceError(null);
    try {
      const conn = await connectRemoteMic();
      try {
        await beginSession(conn.stream, conn);
      } catch (err) {
        conn.close(); // session creation failed — don't leak the connection
        throw err;
      }
    } catch (err) {
      setSourceError((err as Error).message);
    } finally {
      setSourceBusy(false);
    }
  };

  // The third source: the chooser gives way to the chain panel — ../../docs/chainSource.md.
  const startChainSession = () => {
    setSourceOpen(false);
    setChainShown(true);
    setChainOpen(true);
  };

  // Record the chain's output; ending the take closes the listener AND the panel with its frame.
  const recordChain = async (stream: MediaStream, close: () => void) => {
    await beginSession(
      stream,
      {
        close: () => {
          close();
          setChainOpen(false);
          setChainShown(false);
        },
      },
      true,
    );
    setChainShown(false);
  };

  const handleResumeSession = async (session: Session) => {
    if (recording) {
      setRecOpen(true);
      alert(m["rec.finishFirst"]());
      return;
    }
    let stream: MediaStream;
    let fresh: Session;
    let baseEnvelope: Awaited<ReturnType<typeof api.getEnvelope>> | undefined;
    try {
      stream = await acquireMicrophone();
    } catch (err) {
      alert(describeMicError(err, micErrors()));
      return;
    }
    try {
      // Refetch, so the offset is the latest saved duration and the envelope the stored one.
      fresh = await api.getSession(session.id);
      baseEnvelope = fresh.hasRecording
        ? await api.getEnvelope(session.id).catch(() => undefined)
        : undefined;
    } catch (err) {
      stopTracks(stream); // no take will start on this stream — the microphone goes off
      alert((err as Error).message);
      return;
    }
    setRecording({
      session: fresh,
      stream,
      resumeFrom: fresh.duration,
      baseEnvelope,
    });
    setRecOpen(true);
  };

  const handleDeleteSession = async (id: string) => {
    await api.deleteSession(id);
    // Its moments survive (now session-less), so refresh that list too.
    await refresh();
    refreshMoments();
    if (location.pathname === `/sessions/${id}`) {
      navigate("/sessions");
    }
  };

  const handleCleanSessions = async (ids: string[]) => {
    for (const id of ids) await api.deleteSession(id);
    await refresh();
    refreshMoments();
  };

  const handleSaveRecording = async (result: {
    blob: Blob;
    envelope: import("./types").Envelope;
    duration: number;
    gain: number;
    annotations: Array<{
      startSec: number;
      endSec: number;
      text: string;
      tags: string[];
    }>;
  }) => {
    if (!recording) return;
    const { session, resumeFrom } = recording;
    const updated =
      resumeFrom != null
        ? await api.appendRecording(
            session.id,
            result.blob,
            result.envelope,
            result.duration,
            result.gain,
          )
        : await api.uploadRecording(
            session.id,
            result.blob,
            result.envelope,
            result.duration,
            result.gain,
          );
    // An appended take's annotations are relative to it, so shift onto the whole timeline.
    const offset = resumeFrom ?? 0;

    // The take is SAVED from here on: nothing below may fail the save, or the recorder's Retry would upload it a second time (docs/recordings.md).
    for (const a of result.annotations) {
      await api
        .addAnnotation(session.id, {
          ...a,
          startSec: a.startSec + offset,
          endSec: a.endSec + offset,
        })
        .catch((err: unknown) => console.error("annotation not saved", err));
    }
    // Pin the seam where the resumed take begins so it's easy to find later.
    if (resumeFrom != null) {
      await api
        .addMarker(session.id, {
          atSec: offset,
          comment: m["rec.resumedOn"]({ at: fmtStamp() }),
        })
        .catch(() => {});
    }
    await refresh().catch((err: unknown) => console.error(err));
    refreshMoments();
    recording.rtc?.close();
    setRecording(null);
    navigate(`/sessions/${updated.id}`);
  };

  const allTags = [...new Set(moments.flatMap((m) => m.tags))].sort();

  const openSong = (s: Song, tab?: SongTab) =>
    navigate(`/songs/${s.id}${tab ? `?tab=${tab}` : ""}`);

  const handleToggleSongFavorite = async (s: Song) => {
    await api.setSongFavorite(s.id, !s.favorite);
    refreshSongs();
  };

  if (!authChecked) {
    return (
      <div className="login-screen">
        <p className="muted">{m["common.loading"]()}</p>
      </div>
    );
  }

  // A recovery screen, not the way in: reached when the trip to the login brought no session back.
  if (!user) {
    return <LoginView loginUrl={api.loginUrl} />;
  }

  const activeNav = navForPath(location.pathname);

  // A running take collapses to a fixed bottom bar whenever its pop-in is closed.
  const recMinimized = recording != null && !recOpen;

  return (
    <div className="app">
      <HeaderView
        activeNav={activeNav}
        onHome={() => navigate("/sessions")}
        onNav={(tab) => navigate(tabPath(tab))}
        onStartSession={handleStartSession}
        onOpenSettings={() => navigate("/settings")}
      />

      <main className="main">
        <RecoveredTakes />
        <div className={`main-inner${recMinimized ? " has-rec-bar" : ""}`}>
          <Routes>
            <Route path="/" element={<Navigate to="/sessions" replace />} />

            {HOME_ROUTES.map(({ path, tab }) => (
              <Route
                key={path}
                path={`/${path}`}
                element={
                  <HomeView
                    sessions={sessions}
                    releases={releases}
                    pages={pages}
                    songs={songs}
                    moments={moments}
                    tab={tab}
                    onOpen={(s) => navigate(`/sessions/${s.id}`)}
                    onOpenMoment={(m) => navigate(`/moments/${m.id}`)}
                    onDeleteSession={handleDeleteSession}
                    onOpenRelease={(r) => navigate(`/releases/${r.id}`)}
                    onNewRelease={() => navigate("/releases/new")}
                    onOpenPage={(p) => navigate(`/pages/${p.id}`)}
                    onNewPage={() => navigate("/pages/new")}
                    onOpenSong={openSong}
                    onNewSong={() => navigate("/songs/new")}
                    onToggleSongFavorite={handleToggleSongFavorite}
                  />
                }
              />
            ))}

            <Route
              path="/sessions/:id"
              element={
                <SessionRoute
                  allTags={allTags}
                  onBack={() => {
                    refresh();
                    navigate("/sessions");
                  }}
                  onChange={refreshSessions}
                  onResume={handleResumeSession}
                />
              }
            />

            <Route
              path="/releases/new"
              element={
                <ReleaseFormView
                  onSave={async (data) => {
                    const r = await api.createRelease(data);
                    await refreshReleases();
                    navigate(`/releases/${r.id}`);
                    return r;
                  }}
                  onCancel={() => navigate("/releases")}
                />
              }
            />

            <Route
              path="/releases/:id"
              element={
                <ReleaseRoute
                  onDeleted={() => {
                    refreshReleases();
                    navigate("/releases");
                  }}
                  onChange={refreshReleases}
                  onBack={() => navigate("/releases")}
                />
              }
            />

            <Route
              path="/pages/new"
              element={
                <PageFormView
                  releases={releases}
                  onSave={async (data) => {
                    const p = await api.createPage(data);
                    await refreshPages();
                    navigate(`/pages/${p.id}`);
                    return p;
                  }}
                  onCancel={() => navigate("/releases")}
                />
              }
            />

            <Route
              path="/pages/:id"
              element={
                <PageRoute
                  allReleases={releases}
                  onChange={refreshPages}
                  onDeleted={() => {
                    refreshPages();
                    navigate("/releases");
                  }}
                  onBack={() => navigate("/releases")}
                />
              }
            />

            <Route
              path="/songs/new"
              element={
                <SongFormView
                  onSave={async (data) => {
                    const s = await api.createSong(data);
                    await refreshSongs();
                    navigate(`/songs/${s.id}`);
                    return s;
                  }}
                  onCancel={() => navigate("/songs")}
                />
              }
            />

            <Route
              path="/songs/:id"
              element={
                <SongRoute
                  onChange={refreshSongs}
                  onDeleted={() => {
                    refreshSongs();
                    navigate("/songs");
                  }}
                  onBack={() => navigate("/songs")}
                />
              }
            />

            <Route
              path="/moments/:id"
              element={
                <MomentRoute
                  onBack={() => navigate("/sessions")}
                  onDeleted={() => {
                    refreshMoments();
                    navigate("/sessions");
                  }}
                  onOpenSession={(sessionUid, seekTo) =>
                    navigate(
                      `/sessions/${sessionUid}${
                        seekTo != null ? `?t=${seekTo}` : ""
                      }`,
                    )
                  }
                />
              }
            />

            <Route
              path="/exercices"
              element={
                <ExercisesView onOpen={(id) => navigate(`/exercices/${id}`)} />
              }
            />

            <Route
              path="/exercices/singing"
              element={
                <SingingExercisesView onBack={() => navigate("/exercices")} />
              }
            />

            <Route
              path="/exercices/random-chords"
              element={
                <RandomChordsExercise onBack={() => navigate("/exercices")} />
              }
            />

            <Route
              path="/exercices/tuner"
              element={<GuitarTuner onBack={() => navigate("/exercices")} />}
            />

            <Route path="/remote" element={<RemoteMicView />} />

            <Route
              path="/settings"
              element={
                <SettingsView
                  user={user}
                  sessions={sessions}
                  onCleanSessions={handleCleanSessions}
                  onLogout={logout}
                />
              }
            />

            {/* Moments hang under their sessions now — ../../docs/recordings.md; the old list address still lands. */}
            {/* Pages group their releases on /releases now — ../../docs/pages.md; the old list address still lands. */}
            <Route
              path="/pages"
              element={<Navigate to="/releases" replace />}
            />
            <Route
              path="/moments"
              element={<Navigate to="/sessions" replace />}
            />
            <Route path="*" element={<Navigate to="/sessions" replace />} />
          </Routes>

          {/* The active recorder, at a STABLE position: the pop-in is two class swaps, never a re-parent — ../../docs/audio.md. */}
          {recording && (
            <div
              className={recOpen ? "rec-popin-backdrop" : "rec-dock"}
              onClick={(e) => {
                if (recOpen && e.target === e.currentTarget) setRecOpen(false);
              }}
            >
              <div
                className={recOpen ? "rec-popin" : "rec-dock"}
                role={recOpen ? "dialog" : undefined}
                aria-modal={recOpen || undefined}
                aria-label={recOpen ? m["rec.dialog"]() : undefined}
              >
                <RecorderView
                  key="active-recorder"
                  labels={recorderLabels()}
                  session={recording.session}
                  stream={recording.stream}
                  allTags={allTags}
                  baseEnvelope={recording.baseEnvelope}
                  minimized={recMinimized}
                  onExpand={() => setRecOpen(true)}
                  headerActions={
                    recOpen && (
                      <>
                        {recording.chain && (
                          <button
                            type="button"
                            className="rec-popin-hide"
                            onClick={() => setChainShown(true)}
                            title={m["chain.showTitle"]()}
                          >
                            <Workflow className="size-4" /> {m["chain.show"]()}
                          </button>
                        )}
                        <button
                          type="button"
                          className="rec-popin-hide"
                          onClick={() => setRecOpen(false)}
                          title={m["rec.hideTitle"]()}
                        >
                          <ChevronDown className="size-4" /> {m["rec.hide"]()}
                        </button>
                      </>
                    )
                  }
                  onSave={handleSaveRecording}
                  onDiscard={() => {
                    recording.rtc?.close();
                    setRecording(null);
                    refresh();
                    navigate("/sessions");
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </main>

      <SessionSourceDialog
        open={sourceOpen}
        remoteAvailable={remoteAvailable}
        busy={sourceBusy}
        error={sourceError}
        onLocal={startLocalSession}
        onRemote={startRemoteSession}
        onChain={startChainSession}
        onClose={() => setSourceOpen(false)}
      />

      {chainOpen && user && (
        <ChainSourcePanel
          who={user.email || user.sub}
          recording={!!recording?.chain}
          shown={chainShown}
          onRecord={recordChain}
          onCancel={() => {
            setChainOpen(false);
            setChainShown(false);
          }}
          onHide={() => setChainShown(false)}
        />
      )}
    </div>
  );
}
