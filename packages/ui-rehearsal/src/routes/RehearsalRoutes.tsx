// RehearsalRoutes.tsx — the rehearsal pages as RELATIVE routes, for a host that mounts them under
// its prefix ("/rehearsal/*"), inside its own frame and below RehearsalRecording.
// Every navigation goes through useRehearsalNav: a bare "/sessions" would leave the prefix.

import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "../api";
import { RecoveredTakes } from "../components/RecoveredTakes";
import { ServerOnly } from "../components/ServerOnly";
import { useRehearsalHost, useRehearsalNav } from "../host";
import { useRehearsalRecording } from "../recording/context";
import type { HomeTab, Song, SongTab } from "../types";
import { ExercisesView } from "../views/ExercisesView";
import { GuitarTuner } from "../views/GuitarTuner";
import { HomeView } from "../views/HomeView";
import { PageFormView } from "../views/PageFormView";
import { RandomChordsExercise } from "../views/RandomChordsExercise";
import { ReleaseFormView } from "../views/ReleaseFormView";
import { SingingExercisesView } from "../views/SingingExercisesView";
import { SongFormView } from "../views/SongFormView";
import {
  MomentRoute,
  PageRoute,
  ReleaseRoute,
  SessionRoute,
  SongRoute,
} from "./params";
import { useRehearsalData } from "./useRehearsalData";
import "../styles/index.css";

// The home list routes, each with the HomeView tab it selects.
const HOME_ROUTES: { path: string; tab: HomeTab }[] = [
  { path: "sessions", tab: "sessions" },
  { path: "releases", tab: "releases" },
  { path: "songs", tab: "songbook" },
];

export function RehearsalRoutes() {
  const { go, path } = useRehearsalNav();
  const { settingsHref } = useRehearsalHost();
  const { pathname } = useLocation();
  const { minimized, resume } = useRehearsalRecording();
  const d = useRehearsalData();

  const handleDeleteSession = async (id: string) => {
    await api.deleteSession(id);
    // Its moments survive (now session-less), so the moments list refreshes too.
    await d.refreshSessions();
    if (pathname === path(`/sessions/${id}`)) go("/sessions");
  };

  const openSong = (s: Song, tab?: SongTab) =>
    go(`/songs/${s.id}${tab ? `?tab=${tab}` : ""}`);

  const toggleSongFavorite = async (s: Song) => {
    await api.setSongFavorite(s.id, !s.favorite);
    void d.refreshSongs();
  };

  const toSessions = <Navigate to={path("/sessions")} replace />;

  return (
    <div className="rehearsal-root rehearsal-page">
      <main className="main">
        <RecoveredTakes />
        <div className={`main-inner${minimized ? " has-rec-bar" : ""}`}>
          <Routes>
            <Route index element={toSessions} />

            {HOME_ROUTES.map(({ path: p, tab }) => (
              <Route
                key={p}
                path={p}
                element={
                  <HomeView
                    sessions={d.sessions}
                    releases={d.releases}
                    pages={d.pages}
                    songs={d.songs}
                    moments={d.moments}
                    tab={tab}
                    onOpen={(s) => go(`/sessions/${s.id}`)}
                    onOpenMoment={(x) => go(`/moments/${x.id}`)}
                    onDeleteSession={handleDeleteSession}
                    onOpenRelease={(r) => go(`/releases/${r.id}`)}
                    onNewRelease={() => go("/releases/new")}
                    onOpenPage={(x) => go(`/pages/${x.id}`)}
                    onNewPage={() => go("/pages/new")}
                    onOpenSong={openSong}
                    onNewSong={() => go("/songs/new")}
                    onToggleSongFavorite={toggleSongFavorite}
                    onSongsChanged={() => void d.refreshSongs()}
                    onPublicationsReachable={() => {
                      void d.refreshReleases();
                      void d.refreshPages();
                    }}
                  />
                }
              />
            ))}

            <Route
              path="sessions/:id"
              element={
                <SessionRoute
                  allTags={d.allTags}
                  onBack={() => {
                    void d.refreshSessions();
                    go("/sessions");
                  }}
                  onChange={() => void d.refreshSessions()}
                  onResume={resume}
                />
              }
            />

            <Route
              path="releases/new"
              element={
                <ServerOnly>
                  <ReleaseFormView
                    onSave={async (data) => {
                      const r = await api.createRelease(data);
                      await d.refreshReleases();
                      go(`/releases/${r.id}`);
                      return r;
                    }}
                    onCancel={() => go("/releases")}
                  />
                </ServerOnly>
              }
            />

            <Route
              path="releases/:id"
              element={
                <ServerOnly>
                  <ReleaseRoute
                    onDeleted={() => {
                      void d.refreshReleases();
                      go("/releases");
                    }}
                    onChange={() => void d.refreshReleases()}
                    onBack={() => go("/releases")}
                  />
                </ServerOnly>
              }
            />

            <Route
              path="pages/new"
              element={
                <ServerOnly>
                  <PageFormView
                    releases={d.releases}
                    onSave={async (data) => {
                      const p = await api.createPage(data);
                      await d.refreshPages();
                      go(`/pages/${p.id}`);
                      return p;
                    }}
                    onCancel={() => go("/releases")}
                  />
                </ServerOnly>
              }
            />

            <Route
              path="pages/:id"
              element={
                <ServerOnly>
                  <PageRoute
                    allReleases={d.releases}
                    onChange={() => void d.refreshPages()}
                    onDeleted={() => {
                      void d.refreshPages();
                      go("/releases");
                    }}
                    onBack={() => go("/releases")}
                  />
                </ServerOnly>
              }
            />

            <Route
              path="songs/new"
              element={
                <SongFormView
                  onSave={async (data) => {
                    const s = await api.createSong(data);
                    await d.refreshSongs();
                    go(`/songs/${s.id}`);
                    return s;
                  }}
                  onCancel={() => go("/songs")}
                />
              }
            />

            <Route
              path="songs/:id"
              element={
                <SongRoute
                  onChange={() => void d.refreshSongs()}
                  onDeleted={() => {
                    void d.refreshSongs();
                    go("/songs");
                  }}
                  onBack={() => go("/songs")}
                />
              }
            />

            <Route
              path="moments/:id"
              element={
                <MomentRoute
                  onBack={() => go("/sessions")}
                  onDeleted={() => {
                    void d.refreshSessions();
                    go("/sessions");
                  }}
                  onOpenSession={(sessionUid, seekTo) =>
                    go(
                      `/sessions/${sessionUid}${seekTo != null ? `?t=${seekTo}` : ""}`,
                    )
                  }
                />
              }
            />

            <Route
              path="exercices"
              element={
                <ExercisesView onOpen={(id) => go(`/exercices/${id}`)} />
              }
            />
            <Route
              path="exercices/singing"
              element={<SingingExercisesView onBack={() => go("/exercices")} />}
            />
            <Route
              path="exercices/random-chords"
              element={<RandomChordsExercise onBack={() => go("/exercices")} />}
            />
            <Route
              path="exercices/tuner"
              element={<GuitarTuner onBack={() => go("/exercices")} />}
            />

            {/* The settings are a section of the host's own page now. */}
            <Route
              path="settings"
              element={
                <Navigate to={settingsHref ?? path("/sessions")} replace />
              }
            />
            {/* Moments hang under their sessions, pages group their releases; the old list addresses still land. */}
            <Route
              path="pages"
              element={<Navigate to={path("/releases")} replace />}
            />
            <Route path="moments" element={toSessions} />
            <Route path="*" element={toSessions} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
