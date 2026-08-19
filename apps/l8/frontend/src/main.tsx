import { parseLaunch, projectBasename } from "@studio/project-shell/launch";
import { isShare, shareToken } from "@studio/web-protocol/projects";
import { Profiler } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthGate } from "./components/AuthGate";
import { EngineGate } from "./components/EngineGate";
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
 * l8 never did, and drew waveforms for a long time without anyone noticing: the canvas needs no
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
 * parts disabled — it is the wrong stack. And `/l8/` with nothing after it is no longer a
 * mistake to redirect away from: it is the HOME, the screen where projects are chosen, which
 * needs the account but neither an engine nor a project. See projects/Home.tsx.
 */
const at = parseLaunch(
  window.location.pathname,
  "l8",
  import.meta.env.BASE_URL,
);
const sharedToken = at && isShare(at.repo) ? shareToken(at.project) : null;

// The gates before the editor, the router outside them (so a deep link survives sign-in), and NO React.StrictMode
// — its double-mount thrashes the WebGL compositor's context and froze Firefox. See docs/shell.md.
ReactDOM.createRoot(document.getElementById("root")!).render(
  // The basename is the app's mount AND the project it was opened on — `/<repo>/<song.l8>`.
  // BASE_URL is the one place the mount is declared (vite `base`), and it is `/` since l8 took
  // the origin root; the rest comes out of the address pl8 sent us to. React Router only ever
  // writes BELOW its basename, so routes.ts stays written as if the app owned the origin — which
  // it now does — and the project can no longer be rewritten out of the URL, which is what made
  // a tab need storage to remember it.
  <BrowserRouter
    basename={projectBasename(
      window.location.pathname,
      "l8",
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
          {!at ? (
            <Home />
          ) : profiling ? (
            <Profiler id="app" onRender={reportCommit}>
              <EngineGate />
            </Profiler>
          ) : (
            <EngineGate />
          )}
        </AuthGate>
      )}
    </LocaleProvider>
  </BrowserRouter>,
);
