// RehearsalRoutes.tsx — the rehearsal pages as RELATIVE routes, for a host that mounts them under
// its prefix ("/rehearsal/*"), inside its own frame and below RehearsalRecording.
// Every navigation goes through useRehearsalNav: a bare "/sessions" would leave the prefix.

import { AskHost } from "@frediverse/ui/ask";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { api } from "../api";
import { RecoveredTakes } from "../components/RecoveredTakes";
import { ServerOnly } from "../components/ServerOnly";
import { useRehearsalHost, useRehearsalNav } from "../host";
import { useRehearsalRecording } from "../recording/context";
import type { HomeTab, Moment } from "../types";
import { ExercisesView } from "../views/ExercisesView";
import { GuitarTuner } from "../views/GuitarTuner";
import { HomeView } from "../views/HomeView";
import { PageFormView } from "../views/PageFormView";
import { RandomChordsExercise } from "../views/RandomChordsExercise";
import { ReleaseFormView } from "../views/ReleaseFormView";
import { SingingExercisesView } from "../views/SingingExercisesView";
import {
  MomentRoute,
  PageRoute,
  RecordingRoute,
  ReleaseRoute,
  SessionRoute,
} from "./params";
import { useRehearsalData } from "./useRehearsalData";
import "../styles/index.css";

// The home list routes, each with the HomeView tab it selects.
const HOME_ROUTES: { path: string; tab: HomeTab }[] = [
  { path: "sessions", tab: "sessions" },
  { path: "releases", tab: "releases" },
];

/** A moment's recording at its start: its session's page when one saved it, else the capture's own. */
function recordingHref(x: Moment): string {
  if (x.sessionId) return `/sessions/${x.sessionId}?t=${x.startSec}`;
  const q = new URLSearchParams({
    path: x.recordingPath ?? "",
    t: String(x.startSec),
  });
  return `/recording?${q}`;
}

export function RehearsalRoutes() {
  const { go, path } = useRehearsalNav();
  const navigate = useNavigate();
  const { settingsHref } = useRehearsalHost();
  const { pathname } = useLocation();
  const { barShown, resume } = useRehearsalRecording();
  const d = useRehearsalData();

  const handleDeleteSession = async (id: string) => {
    await api.deleteSession(id);
    // Its moments survive (now session-less), so the moments list refreshes too.
    await d.refreshSessions();
    if (pathname === path(`/sessions/${id}`)) go("/sessions");
  };

  const toSessions = <Navigate to={path("/sessions")} replace />;

  return (
    <div className="rehearsal-root rehearsal-page">
      {/* Where every confirmation of these pages is drawn; without it `confirmLoss` answers no. */}
      <AskHost />
      <main className="main">
        <RecoveredTakes />
        <div className={`main-inner${barShown ? " has-rec-bar" : ""}`}>
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
                    moments={d.moments}
                    tab={tab}
                    onOpen={(s) => go(`/sessions/${s.id}`)}
                    onOpenMoment={(x) => go(`/moments/${x.id}`)}
                    onDeleteSession={handleDeleteSession}
                    onOpenRelease={(r) => go(`/releases/${r.id}`)}
                    onNewRelease={() => go("/releases/new")}
                    onOpenPage={(x) => go(`/pages/${x.id}`)}
                    onNewPage={() => go("/pages/new")}
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
                    onSave={async (data, onProgress) => {
                      const r = await api.createRelease(data, onProgress);
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
                <ServerOnly onAvailable={d.refreshReleases}>
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
                <ServerOnly onAvailable={d.refreshReleases}>
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
              path="moments/:id"
              element={
                <MomentRoute
                  onBack={() => go("/sessions")}
                  onDeleted={() => {
                    void d.refreshSessions();
                    go("/sessions");
                  }}
                  onOpenRecording={(x) => go(recordingHref(x))}
                />
              }
            />

            <Route
              path="recording"
              element={
                <RecordingRoute
                  allTags={d.allTags}
                  // Reached from the médiathèque as often as from here: Back is where it came from.
                  onBack={() =>
                    (window.history.state?.idx ?? 0) > 0
                      ? navigate(-1)
                      : go("/sessions")
                  }
                  onChange={() => void d.refreshSessions()}
                  onOpenSession={(id, seekTo) =>
                    go(
                      `/sessions/${id}${seekTo != null ? `?t=${seekTo}` : ""}`,
                      {
                        replace: true,
                      },
                    )
                  }
                />
              }
            />

            <Route
              path="exercises"
              element={
                <ExercisesView onOpen={(id) => go(`/exercises/${id}`)} />
              }
            />
            <Route
              path="exercises/singing"
              element={<SingingExercisesView onBack={() => go("/exercises")} />}
            />
            <Route
              path="exercises/random-chords"
              element={<RandomChordsExercise onBack={() => go("/exercises")} />}
            />
            <Route
              path="exercises/tuner"
              element={<GuitarTuner onBack={() => go("/exercises")} />}
            />
            {/* Saved links and installed apps carry the French spelling; it lands on the same page. */}
            <Route
              path="exercices/*"
              element={
                <Navigate
                  to={path(pathname.replace(/^.*\/exercices/, "/exercises"))}
                  replace
                />
              }
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
