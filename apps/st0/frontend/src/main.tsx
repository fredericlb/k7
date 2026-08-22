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
/**
 * The waveform's own wrapper and marker rules. A plain stylesheet, not Tailwind, so the `@source`
 * scan cannot produce it — it has to be imported like any other CSS file, exactly as pl8 and k7
 * import it.
 *
 * st0 never did, and drew waveforms for a long time without anyone noticing: the canvas needs no
 * CSS, so the picture looked right. What was missing was `.waveform-wrap { position: relative }`
 * and `.waveform-marker { position: absolute }` — so every onset flag fell out of its positioning
 * context and stacked up in the corner, in normal flow, nowhere near the onset it marked.
 */
import "@studio/ui-waveform/styles.css";

// Report main-thread stalls to the console, so a "random freeze" leaves evidence. Cheap, and console-only.
installFreezeWatchdog();

/**
 * The Profiler is here for the freeze watchdog, not for tuning: a stall in a React app is
 * usually a COMMIT, and without it the report can only say how long the stall lasted. But it
 * bills EVERY commit in the subtree to record the few over the threshold, and this tree commits
 * on every meter frame — so it is off unless someone is actually looking. The flag is
 * `profiling.ts`, shared with the viewport's drift readout. See docs/shell.md.
 */
const profiling = PROFILING;

/**
 * Which of the three things this address is, read out of the address and nothing else — the
 * same way the basename below is, so the two cannot disagree about what this tab is on.
 *
 * A branch here rather than gates switched off inside one stack. A SHARE has no account, no
 * engine and no working copy, so `AuthGate → EngineGate → ProjectGate` is not that stack with
 * parts disabled — it is the wrong stack. And `/st0/` with nothing after it is no longer a
 * mistake to redirect away from: it is the HOME, the screen where projects are chosen, which
 * needs the account but neither an engine nor a project. See projects/Home.tsx.
 */
const at = parseLaunch(
  window.location.pathname,
  "st0",
  import.meta.env.BASE_URL,
);
const sharedToken = at && isShare(at.repo) ? shareToken(at.project) : null;

/**
 * …and the MENU of surfaces, `/external`, read before any of it.
 *
 * Before, because a single segment is a legal project address — `/<dépôt>` opens a lone-project
 * clone — so `parseLaunch` answers this one with a repository called `external` and would send it
 * to the gates. The word is reserved for that reason, which is written down in
 * @studio/web-protocol/projects beside the constant.
 */
const externalIndex = isExternalIndex(
  window.location.pathname,
  import.meta.env.BASE_URL,
);

/**
 * …and when it IS that page, install as that page.
 *
 * A manifest's `start_url` is resolved against the MANIFEST's address, not the document's, so the
 * relative `.` in the one index.html links means `/` wherever you install from — which is right
 * for the editor and wrong here: a second device installed from this menu would come back to the
 * home page every time. A second manifest, swapped before install can be offered, is the only
 * thing that changes it; the browser reads whichever one the document points at.
 *
 * Here rather than in the page's own effect, beside the routing decision it follows from: which
 * app this document IS is one question, answered once. See docs/external.md.
 */
if (externalIndex)
  document
    .querySelector<HTMLLinkElement>('link[rel="manifest"]')
    ?.setAttribute("href", "/manifest-external.webmanifest");

/**
 * …and the fourth thing an address can be: ONE SURFACE, on another device.
 *
 * `<project>/@external/<name>`. Read here beside the other two, off the same pathname, so the
 * three questions this file asks about a tab are asked in one place. It is not a fourth GATE —
 * an external surface needs the account, an engine and a working copy exactly as the editor
 * does — so it rides the same stack and only changes what `ProjectGate` renders at the end of
 * it. See components/ExternalSurface.tsx.
 */
const external = parseExternal(
  window.location.pathname,
  "st0",
  import.meta.env.BASE_URL,
);

// The gates before the editor, the router outside them (so a deep link survives sign-in), and NO React.StrictMode
// — its double-mount thrashes the WebGL compositor's context and froze Firefox. See docs/shell.md.
ReactDOM.createRoot(document.getElementById("root")!).render(
  // The basename is the app's mount AND the project it was opened on — `/<repo>/<song.st0>`.
  // BASE_URL is the one place the mount is declared (vite `base`), and it is `/` since st0 took
  // the origin root; the rest comes out of the address pl8 sent us to. React Router only ever
  // writes BELOW its basename, so routes.ts stays written as if the app owned the origin — which
  // it now does — and the project can no longer be rewritten out of the URL, which is what made
  // a tab need storage to remember it.
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
              // No engine to reach, ever — and `null` is the ONE answer EngineClient already
              // understands as that: it backs off and asks again instead of treating it as a
              // failed connection. So the shell mounts whole, its store stays at rest, and
              // nothing in it needed a second code path for "there is no engine".
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
          {/* No project in the address: the home page, where one is chosen. It is behind the
              account and nothing else — no engine is required to LIST repositories, and the two
              buttons that do need one say so themselves. The Profiler is for the editor's commit
              storm and has nothing to bill here. */}
          {externalIndex ? (
            // The second device's front door: every surface this account can drive, with no
            // project chosen yet. Behind the account like the home page, and like it holding no
            // engine — a menu that took a lease would evict the person playing.
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
