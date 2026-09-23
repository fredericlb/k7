// appMain.tsx — st0 itself: the gates, the router and the editor. It was `main.tsx` until the
// tab strip needed an address on this origin without paying for any of it — main.tsx is now a
// dispatcher that imports one of us, and this is the heavy branch. See apps/st0-desktop/docs/tabs.md.

import { Loader2 } from "@frediverse/ui/icons";
import { setFileApiTally } from "@studio/project-shell/fileApi";
import {
  isExternalIndex,
  parseExternal,
  parseLaunch,
  projectBasename,
} from "@studio/project-shell/launch";
import {
  isShare,
  projectLabel,
  shareToken,
} from "@studio/web-protocol/projects";
import { lazy, Profiler, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
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

import { PROFILING } from "@studio/project-shell/profiling";
import { installFreezeWatchdog, reportCommit, tally } from "./freezeWatchdog";
import { LocaleProvider } from "./i18n";
import { Home } from "./projects/Home";

import "./index.css";
/** The waveform's own wrapper and marker rules — a plain stylesheet, so the `@source` scan cannot produce it and it has to be imported. */
import "@studio/ui-waveform/styles.css";

// Report main-thread stalls to the console, so a "random freeze" leaves evidence. Cheap, and console-only.
installFreezeWatchdog({ commits: PROFILING });
// …and let the file transport report into the same tally: parsing a response is the other thing
// that runs on this thread while a project opens, and the engine link was the only one instrumented.
setFileApiTally(tally);

/** The Profiler is here for the freeze watchdog, and OFF unless someone is looking: it bills every commit in a tree that commits per meter frame. */
const profiling = PROFILING;

/** Which of the three things this address is, read out of the address and nothing else — a branch, a SHARE being the wrong stack rather than a disabled one. */
const at = parseLaunch(
  window.location.pathname,
  "st0",
  import.meta.env.BASE_URL,
);
const sharedToken = at && isShare(at.repo) ? shareToken(at.project) : null;

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

/** …and the worker that makes either an installable app — what it buys is a SECOND opening, not offline; its scope is `/`, and it never prompts. */
if ("serviceWorker" in navigator)
  void import("virtual:pwa-register").then(({ registerSW }) =>
    registerSW({ immediate: true }),
  );

/** …and the fourth thing an address can be: ONE SURFACE on another device — not a fourth GATE, it rides the same stack (components/ExternalSurface.tsx). */
const external = parseExternal(
  window.location.pathname,
  "st0",
  import.meta.env.BASE_URL,
);

/** What is on screen while a split-out screen arrives. The window is already painted in the
 *  app's colour by then (apps/st0-desktop/docs/window.md), so this only has to say "coming". */
function Booting() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

// The gates before the editor, the router outside them, and NO React.StrictMode — its double-mount freezes Firefox's WebGL context (docs/shell.md).
ReactDOM.createRoot(document.getElementById("root")!).render(
  // The basename is the app's mount AND the project it was opened on: React Router only writes BELOW it, so the project cannot be rewritten out.
  <BrowserRouter
    basename={projectBasename(
      window.location.pathname,
      "st0",
      import.meta.env.BASE_URL,
    )}
  >
    <LocaleProvider>
      {sharedToken ? (
        <Suspense fallback={<Booting />}>
          <SharedGate token={sharedToken}>
            {(share) => (
              <App
                snapshot={share}
                // No engine to reach, ever — and `null` is the ONE answer EngineClient already understands as that, so it backs off.
                engineUrl={() => null}
                engineLatency={null}
                userEmail=""
                onQuitWorkspace={() => {}}
                onChangeEngine={() => {}}
              />
            )}
          </SharedGate>
        </Suspense>
      ) : (
        <AuthGate>
          <Suspense fallback={<Booting />}>
            {/* No project in the address: the home page, behind the account and nothing else, since listing repositories needs no engine. */}
            {externalIndex ? (
              // The second device's front door: every surface this account can drive, holding no engine — a lease would evict the person playing.
              <ExternalIndex />
            ) : !at ? (
              <Home />
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
    </LocaleProvider>
  </BrowserRouter>,
);
