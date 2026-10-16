// appMain.tsx — k7 itself: the gates, the router and the editor. It was `main.tsx` until the
// tab strip needed an address on this origin without paying for any of it — main.tsx is now a
// dispatcher that imports one of us, and this is the heavy branch. See apps/k7-standalone/docs/tabs.md.

import { clearDevPerfEntries } from "@frediverse/ui/dev-perf";
import { Loader2 } from "@frediverse/ui/icons";
import { registerWorker } from "@frediverse/vite-config/register";
import { setFileApiTally } from "@studio/project-shell/fileApi";
import {
  isExternalIndex,
  parseExternal,
  parseLaunch,
  projectBasename,
} from "@studio/project-shell/launch";
import {
  isHomePage,
  isShare,
  projectLabel,
  shareToken,
} from "@studio/web-protocol/projects";
import { lazy, Profiler, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { canServeLenses, serveLenses } from "./camera/serveLenses";
import { AuthGate } from "./components/AuthGate";

/** The four screens that are NOT the home page, split out of the entry — see docs/shell.md.
 *  Only one address is ever taken, so only one of these is ever fetched. */
const App = lazy(() => import("./App"));
const EngineGate = lazy(() =>
  import("./components/EngineGate").then((m) => ({ default: m.EngineGate })),
);
const ExternalIndex = lazy(() =>
  import("./components/ExternalIndex").then((m) => ({
    default: m.ExternalIndex,
  })),
);
const SharedGate = lazy(() =>
  import("./components/SharedGate").then((m) => ({ default: m.SharedGate })),
);
const RehearsalPublicPage = lazy(() =>
  import("@studio/ui-rehearsal/public").then((m) => ({
    default: m.RehearsalPublicPage,
  })),
);
const RehearsalRemote = lazy(() =>
  import("@studio/ui-rehearsal/public").then((m) => ({
    default: m.RehearsalRemote,
  })),
);

import { PROFILING } from "@studio/project-shell/profiling";
import { publicPageAt, RehearsalRecording } from "@studio/ui-rehearsal";
import { installFreezeWatchdog, reportCommit, tally } from "./freezeWatchdog";
import { LocaleProvider } from "./i18n";
import { installLongPress } from "./longPress";
import { PaneBoundary } from "./PaneBoundary";
import {
  ENGINE_SETTINGS_ROUTE,
  LIBRARIES_ROUTE,
  MEDIA_ROUTE,
  REHEARSAL_ROUTE,
  SETTINGS_ROUTE,
  TASKS_ROUTE,
} from "./projects/api";
import { Home } from "./projects/Home";
import { RehearsalHost } from "./projects/RehearsalHost";
import { RehearsalPage } from "./projects/RehearsalPage";

/** The home's other pages, fetched when visited: the médiathèque carries the editor stack the login and home pages must not wait for (docs/audit.md). */
const LibrariesPage = lazy(() =>
  import("./projects/LibrariesPage").then((m) => ({
    default: m.LibrariesPage,
  })),
);
const MediaPage = lazy(() =>
  import("./projects/MediaPage").then((m) => ({ default: m.MediaPage })),
);
const TasksPage = lazy(() =>
  import("./projects/TasksPage").then((m) => ({ default: m.TasksPage })),
);
const DesktopEnginePage = lazy(() =>
  import("./settings/DesktopEnginePage").then((m) => ({
    default: m.DesktopEnginePage,
  })),
);
const SettingsPage = lazy(() =>
  import("./settings/SettingsPage").then((m) => ({
    default: m.SettingsPage,
  })),
);

import "./index.css";
/** The waveform's own wrapper and marker rules — a plain stylesheet, so the `@source` scan cannot produce it and it has to be imported. */
import "@studio/ui-waveform/styles.css";

// Report main-thread stalls to the console, so a "random freeze" leaves evidence. Cheap, and console-only.
installFreezeWatchdog({ commits: PROFILING });
// …and let the file transport report into the same tally: parsing a response is the other thing
// that runs on this thread while a project opens, and the engine link was the only one instrumented.
setFileApiTally(tally);
// A held finger or pen is a right-click on every surface, an iPad included (docs/contextMenu.md).
installLongPress();

// A desktop quit asks every page to write what its panes hold before the servers stop (commons/packages/electron-shell/docs/shell.md).
(globalThis as { __beforeQuit?: () => Promise<unknown> }).__beforeQuit = () =>
  import("@studio/ui-editor/autosave").then((m) => m.flushAutosaves());

/** The Profiler is here for the freeze watchdog, and OFF unless someone is looking: it bills every commit in a tree that commits per meter frame. */
const profiling = PROFILING;

/** The pages hanging off the home — `/libraries`, `/settings`, `/tasks`, `/media/…` — read FIRST: `parseLaunch` would take the word for a workspace. */
const homePage = isHomePage(window.location.pathname, import.meta.env.BASE_URL);

/** Which of the three things this address is, read out of the address and nothing else — a branch, a SHARE being the wrong stack rather than a disabled one. */
const at = homePage
  ? null
  : parseLaunch(window.location.pathname, "k7", import.meta.env.BASE_URL);
const sharedToken = at && isShare(at.repo) ? shareToken(at.project) : null;

/** …and a rehearsal PUBLIC page, `/rehearsal/@<nametag>`, which nobody signs in to see: read before the AuthGate. */
const rehearsalNametag = homePage
  ? publicPageAt(
      window.location.pathname,
      `${import.meta.env.BASE_URL.replace(/\/$/, "")}${REHEARSAL_ROUTE}`,
    )
  : null;

/** …and the MENU of surfaces, `/external`, read BEFORE any of it: a single segment is a legal project address, so the word is reserved. */
const externalIndex = isExternalIndex(
  window.location.pathname,
  import.meta.env.BASE_URL,
);

/** …and when it IS that page, install as that page: a manifest's `start_url` resolves against the MANIFEST's address (docs/external.md). */
if (externalIndex) {
  document
    .querySelector<HTMLLinkElement>('link[rel="manifest"]')
    ?.setAttribute("href", "/manifest-external.webmanifest");
  // iOS reads the name off the meta and never off the manifest, so the two are swapped together.
  document
    .querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')
    ?.setAttribute("content", "surfaces");
}

/**
 * …and every page says which one it is. Off the ADDRESS, so it is right before anything has
 * loaded; `App` refines it to the song's own name once it has one.
 */
if (at && !isShare(at.repo))
  document.title =
    at.project === "."
      ? at.repo
      : projectLabel(at.project.split("/").pop() ?? "");

/** …and this machine's own window offers the cameras it may open, to a device that may not — the
 *  loopback origin being both the secure context and the proof of whose machine this is. */
if (canServeLenses()) serveLenses();

/** …and the worker that makes either an installable app — a SECOND opening, not offline; its scope is `/`, and each deploy replaces it (@frediverse/vite-config/register). */
if ("serviceWorker" in navigator) registerWorker();

/** …and the fourth thing an address can be: ONE SURFACE on another device — not a fourth GATE, it rides the same stack (components/ExternalSurface.tsx). */
const external = parseExternal(
  window.location.pathname,
  "k7",
  import.meta.env.BASE_URL,
);

/** What is on screen while a split-out screen arrives. The window is already painted in the
 *  app's colour by then (apps/k7/frontend/docs/shell.md), so this only has to say "coming". */
function Booting() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

// React's DEV build leaves a `performance.measure` per render that the browser keeps forever — cleared (docs/shell.md).
clearDevPerfEntries(import.meta.env.DEV);

// The gates before the editor, the router outside them, and NO React.StrictMode — its double-mount freezes Firefox's WebGL context (docs/shell.md).
ReactDOM.createRoot(document.getElementById("root")!, {
  // What the boundaries catch, and what nothing did, both reach the console with their component stack.
  onCaughtError: (error, info) =>
    console.error("[caught]", error, info.componentStack),
  onUncaughtError: (error, info) =>
    console.error("[uncaught]", error, info.componentStack),
}).render(
  // The basename is the app's mount AND the project it was opened on: React Router only writes BELOW it, so the project cannot be rewritten out.
  <BrowserRouter
    basename={
      homePage
        ? import.meta.env.BASE_URL
        : projectBasename(
            window.location.pathname,
            "k7",
            import.meta.env.BASE_URL,
          )
    }
  >
    <LocaleProvider>
      {/* The last line: a fault that escaped every pane's own boundary draws a card here, not a white page. */}
      <PaneBoundary name="k7">
        {sharedToken ? (
          <Suspense fallback={<Booting />}>
            <SharedGate token={sharedToken}>
              {(share) => (
                <App
                  snapshot={share}
                  // The visitor's own session on the server's engine, through the share's player — docs/shared.md.
                  engineUrl={share.player}
                  engineLatency={null}
                  userEmail=""
                  onQuitWorkspace={() => {}}
                  onChangeEngine={() => {}}
                />
              )}
            </SharedGate>
          </Suspense>
        ) : rehearsalNametag ? (
          <Suspense fallback={<Booting />}>
            <RehearsalPublicPage nametag={rehearsalNametag} />
          </Suspense>
        ) : (
          <AuthGate>
            <Suspense fallback={<Booting />}>
              {/* No project in the address: the home page, behind the account and nothing else, since listing workspaces needs no engine. */}
              {externalIndex ? (
                // The second device's front door: every surface this account can drive, holding no engine — a lease would evict the person playing.
                <ExternalIndex />
              ) : !at ? (
                // The pages with no project are ROUTES, so going between them reloads nothing; a take outlives them all.
                <RehearsalHost>
                  <RehearsalRecording>
                    {/* Inside the take's holder, so a page arriving never hides the take in progress. */}
                    <Suspense fallback={<Booting />}>
                      <Routes>
                        <Route
                          path={LIBRARIES_ROUTE}
                          element={<LibrariesPage />}
                        />
                        <Route
                          path={SETTINGS_ROUTE}
                          element={<SettingsPage />}
                        />
                        <Route
                          path={ENGINE_SETTINGS_ROUTE}
                          element={<DesktopEnginePage />}
                        />
                        <Route path={TASKS_ROUTE} element={<TasksPage />} />
                        <Route
                          path={`${MEDIA_ROUTE}/*`}
                          element={<MediaPage />}
                        />
                        {/* The phone's microphone: a page of its own, outside the frame. */}
                        <Route
                          path={`${REHEARSAL_ROUTE}/remote`}
                          element={<RehearsalRemote />}
                        />
                        <Route
                          path={`${REHEARSAL_ROUTE}/*`}
                          element={<RehearsalPage />}
                        />
                        <Route path="*" element={<Home />} />
                      </Routes>
                    </Suspense>
                  </RehearsalRecording>
                </RehearsalHost>
              ) : profiling ? (
                <Profiler id="app" onRender={reportCommit}>
                  <EngineGate external={external} />
                </Profiler>
              ) : (
                <EngineGate external={external} />
              )}
            </Suspense>
          </AuthGate>
        )}
      </PaneBoundary>
    </LocaleProvider>
  </BrowserRouter>,
);
