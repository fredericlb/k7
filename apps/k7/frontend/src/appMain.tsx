// appMain.tsx — k7 itself: the gates, the router and the editor; main.tsx imports it unless the address is the
// documentation host, so the docs never load the editor. The router is mounted by the address's SCOPE
// (address.ts), so going into a project or out of one swaps the tree without a page load (appNav.ts).

import { clearDevPerfEntries } from "@frediverse/ui/dev-perf";
import { registerWorker } from "@frediverse/vite-config/register";
import {
  setFileApiRevision,
  setFileApiTally,
} from "@studio/project-shell/fileApi";
import { GateWait, releaseSplash } from "@studio/project-shell/progress";
import { projectLabel } from "@studio/web-protocol/projects";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  lazy,
  Profiler,
  type ReactNode,
  Suspense,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { type Scope, scopeOf } from "./address";
import { engines } from "./api";
import { currentScopeKey, subscribeAddress, useScopeWatch } from "./appNav";
import { canServeLenses, serveLenses } from "./camera/serveLenses";
import { AuthGate } from "./components/AuthGate";

/** The four screens that are NOT the home page, split out of the entry — see docs/shell.md.
 *  Only one address is ever taken, so only one of these is ever fetched. */
const loadApp = () => import("./App");
const App = lazy(loadApp);
const loadEngineGate = () => import("./components/EngineGate");
const EngineGate = lazy(() =>
  loadEngineGate().then((m) => ({ default: m.EngineGate })),
);
const ExternalIndex = lazy(() =>
  import("./components/ExternalIndex").then((m) => ({
    default: m.ExternalIndex,
  })),
);
/** The home page and its sibling pages, with the rehearsal take held above them: a project page never loads them. */
const loadHomeRoutes = () => import("./projects/HomeRoutes");
const HomeRoutes = lazy(() =>
  loadHomeRoutes().then((m) => ({ default: m.HomeRoutes })),
);
const SharedGate = lazy(() =>
  import("./components/SharedGate").then((m) => ({ default: m.SharedGate })),
);
const RehearsalPublicPage = lazy(() =>
  import("@studio/ui-rehearsal/public").then((m) => ({
    default: m.RehearsalPublicPage,
  })),
);

import { PROFILING } from "@studio/project-shell/profiling";
import { installFreezeWatchdog, reportCommit, tally } from "./freezeWatchdog";
import { currentRevision } from "./hooks/useRevision";
import { LocaleProvider } from "./i18n";
import { installLongPress } from "./longPress";
import { PaneBoundary } from "./PaneBoundary";
import { m } from "./paraglide/messages.js";
import { queryClient } from "./queries/client";
import { forgetLeftScope } from "./scopeLeave";

import "./index.css";
/** The waveform's own wrapper and marker rules — a plain stylesheet, so the `@source` scan cannot produce it and it has to be imported. */
import "@studio/ui-waveform/styles.css";

// Report main-thread stalls to the console, so a "random freeze" leaves evidence. Cheap, and console-only.
installFreezeWatchdog({ commits: PROFILING });
// …and let the file transport report into the same tally: parsing a response is the other thing
// that runs on this thread while a project opens, and the engine link was the only one instrumented.
setFileApiTally(tally);
// The compiled views follow the change token alone, so a pane mounting a moment after another is answered from its read.
setFileApiRevision(currentRevision, (path) =>
  /^\/(graph|project-doc|project-plugins)(\?|$)/.test(path),
);
// A held finger or pen is a right-click on every surface, an iPad included (docs/contextMenu.md).
installLongPress();

/** The Profiler is here for the freeze watchdog, and OFF unless someone is looking: it bills every commit in a tree that commits per meter frame. */
const profiling = PROFILING;

const BASE = import.meta.env.BASE_URL;

// What the page wears before any scope dresses it, put back when a scope does not.
const PAGE_TITLE = document.title;
const manifestLink = document.querySelector<HTMLLinkElement>(
  'link[rel="manifest"]',
);
const appleTitle = document.querySelector<HTMLMetaElement>(
  'meta[name="apple-mobile-web-app-title"]',
);
const PAGE_MANIFEST = manifestLink?.getAttribute("href") ?? null;
const PAGE_APPLE_TITLE = appleTitle?.getAttribute("content") ?? null;

/** Dress the page for its scope: its title off the ADDRESS, right before anything loads; `App` refines it to the song's own name. */
function dressPage(scope: Scope): void {
  document.title =
    scope.kind === "project"
      ? scope.at.project === "."
        ? scope.at.repo
        : projectLabel(scope.at.project.split("/").pop() ?? "")
      : PAGE_TITLE;
  // The surfaces menu installs as itself: a manifest's `start_url` resolves against the MANIFEST's address (docs/external.md).
  const menu = scope.kind === "external-index";
  if (PAGE_MANIFEST !== null)
    manifestLink?.setAttribute(
      "href",
      menu ? "/manifest-external.webmanifest" : PAGE_MANIFEST,
    );
  // iOS reads the name off the meta and never off the manifest, so the two are swapped together.
  if (PAGE_APPLE_TITLE !== null)
    appleTitle?.setAttribute("content", menu ? "surfaces" : PAGE_APPLE_TITLE);
}
dressPage(scopeOf(window.location.pathname, BASE));

/** …and the first screen's files start arriving now, while AuthGate asks who you are, not once it has its answer (docs/shell.md). */
const first = scopeOf(window.location.pathname, BASE).kind;
// A failure here is the lazy screen's to report when it asks again, not an unhandled rejection.
if (first === "home") loadHomeRoutes().catch(() => {});
else if (first === "project") {
  loadEngineGate().catch(() => {});
  // The editor is the longest download of any start: begun here, not once ProjectGate mounts after the sign-in check.
  loadApp().catch(() => {});
}
// The file hub's hello needs only the cookie, so it runs beside /auth/me rather than after it (`@studio/engine-browser/access`).
if (first === "home" || first === "project") void engines.hostedFiles();

/** …and this machine's own window offers the cameras it may open, to a device that may not — the
 *  loopback origin being both the secure context and the proof of whose machine this is. */
if (canServeLenses()) serveLenses();

/** …and the worker that makes either an installable app — a SECOND opening, not offline; its scope is `/`, and each deploy replaces it (@frediverse/vite-config/register). */
// Not in a phone app's view: its files are already on the device, and the precache would copy them to flash again (docs/localApp.md).
const phone = window as { k7Android?: unknown; k7Ios?: unknown };
const inPhoneApp = !!(phone.k7Android ?? phone.k7Ios);
if ("serviceWorker" in navigator) {
  if (!inPhoneApp) registerWorker();
  else void dropWorkers();
}

/** A phone app's view drops any registration it still holds, and the precache goes with it. */
async function dropWorkers(): Promise<void> {
  const all = await navigator.serviceWorker.getRegistrations();
  await Promise.all(all.map((r) => r.unregister()));
}

/** What is on screen while a split-out screen arrives: at startup, under the splash; later, the bar alone (apps/k7/frontend/docs/shell.md). */
function Booting() {
  return (
    <div className="min-h-screen bg-background">
      <GateWait label={m["startup.loading"]()} />
    </div>
  );
}

// React's DEV build leaves a `performance.measure` per render that the browser keeps forever — cleared (docs/shell.md).
clearDevPerfEntries(import.meta.env.DEV);

/** The router of ONE scope, keyed by it: the project is its basename, so React Router only writes below it and cannot rewrite the project out. */
function Scoped({
  scope,
  ready,
  children,
}: {
  scope: Scope;
  /** False for the one render between two scopes: the last one is gone, the next one not yet drawn. */
  ready: boolean;
  children: ReactNode;
}) {
  return (
    <BrowserRouter key={scope.key} basename={scope.basename}>
      <ScopeWatch />
      {ready ? children : null}
    </BrowserRouter>
  );
}

function ScopeWatch() {
  useScopeWatch();
  return null;
}

/** What the address is, drawn — remounted between scopes, with what the last one kept forgotten in between (appNav.ts). */
function Root() {
  // After the first commit, the children's waits have held the splash already: none, and it goes (docs/icons.md).
  useEffect(releaseSplash, []);
  const key = useSyncExternalStore(subscribeAddress, currentScopeKey);
  const [shown, setShown] = useState(key);
  // Two steps: the old scope unmounts on this render, the page forgets it, and only then does the new one mount.
  const ready = shown === key;
  useLayoutEffect(() => {
    if (ready) return;
    forgetLeftScope();
    dressPage(scopeOf(window.location.pathname, BASE));
    setShown(key);
  }, [key, ready]);
  const scope = scopeOf(window.location.pathname, BASE);
  return (
    // The last line: a fault that escaped every pane's own boundary draws a card here, not a white page.
    <PaneBoundary name="k7" resetKey={scope.key}>
      {scope.kind === "share" ? (
        <Scoped scope={scope} ready={ready}>
          <Suspense fallback={<Booting />}>
            <SharedGate token={scope.token}>
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
        </Scoped>
      ) : scope.kind === "rehearsal-public" ? (
        // A rehearsal PUBLIC page, which nobody signs in to see: before the AuthGate.
        <Scoped scope={scope} ready={ready}>
          <Suspense fallback={<Booting />}>
            <RehearsalPublicPage nametag={scope.nametag} />
          </Suspense>
        </Scoped>
      ) : (
        // Above the router, so moving between scopes does not ask who you are again.
        <AuthGate>
          <Scoped scope={scope} ready={ready}>
            <Suspense fallback={<Booting />}>
              {scope.kind === "external-index" ? (
                // The second device's front door: every surface this account can drive, holding no engine — a lease would evict the person playing.
                <ExternalIndex />
              ) : scope.kind === "home" ? (
                // The pages with no project are ROUTES of one scope, so going between them remounts nothing; a take outlives them all.
                <HomeRoutes fallback={<Booting />} />
              ) : profiling ? (
                <Profiler id="app" onRender={reportCommit}>
                  <EngineGate external={scope.external} />
                </Profiler>
              ) : (
                <EngineGate external={scope.external} />
              )}
            </Suspense>
          </Scoped>
        </AuthGate>
      )}
    </PaneBoundary>
  );
}

// The gates before the editor, and NO React.StrictMode — its double-mount freezes Firefox's WebGL context (docs/shell.md).
ReactDOM.createRoot(document.getElementById("root")!, {
  // What the boundaries catch, and what nothing did, both reach the console with their component stack.
  onCaughtError: (error, info) =>
    console.error("[caught]", error, info.componentStack),
  onUncaughtError: (error, info) =>
    console.error("[uncaught]", error, info.componentStack),
}).render(
  // One cache for the page: the panes' shared reads, keyed by what they follow (queries/client.ts) — and cleared between projects.
  <QueryClientProvider client={queryClient}>
    <LocaleProvider>
      <Root />
    </LocaleProvider>
  </QueryClientProvider>,
);
