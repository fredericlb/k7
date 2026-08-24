import {
  isExternalIndex,
  parseExternal,
  parseLaunch,
  projectBasename,
} from "@studio/project-shell/launch";
import { isShare, shareToken } from "@studio/web-protocol/projects";
import { Profiler } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthGate } from "./components/AuthGate";
import { EngineGate } from "./components/EngineGate";
import { ExternalIndex } from "./components/ExternalIndex";
import { SharedGate } from "./components/SharedGate";
import { installFreezeWatchdog, reportCommit } from "./freezeWatchdog";
import { LocaleProvider } from "./i18n";
import { PROFILING } from "./profiling";
import { Home } from "./projects/Home";
import "./index.css";
/** The waveform's own wrapper and marker rules — a plain stylesheet, so the `@source` scan cannot produce it and it has to be imported. */
import "@studio/ui-waveform/styles.css";

// Report main-thread stalls to the console, so a "random freeze" leaves evidence. Cheap, and console-only.
installFreezeWatchdog();

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
if (externalIndex)
  document
    .querySelector<HTMLLinkElement>('link[rel="manifest"]')
    ?.setAttribute("href", "/manifest-external.webmanifest");

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
      ) : (
        <AuthGate>
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
        </AuthGate>
      )}
    </LocaleProvider>
  </BrowserRouter>,
);
