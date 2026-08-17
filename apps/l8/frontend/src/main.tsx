import { projectBasename } from "@studio/project-shell/launch";
import { Profiler } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthGate } from "./components/AuthGate";
import { EngineGate } from "./components/EngineGate";
import { installFreezeWatchdog, reportCommit } from "./freezeWatchdog";
import { LocaleProvider } from "./i18n";
import { PROFILING } from "./profiling";
import "./index.css";
/**
 * The waveform's own wrapper and marker rules. A plain stylesheet, not Tailwind, so the `@source`
 * scan cannot produce it — it has to be imported like any other CSS file, exactly as st0 and k7
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

// The gates before the editor, the router outside them (so a deep link survives sign-in), and NO React.StrictMode
// — its double-mount thrashes the WebGL compositor's context and froze Firefox. See docs/shell.md.
ReactDOM.createRoot(document.getElementById("root")!).render(
  // The basename is the app's mount AND the project it was opened on — `/l8/<repo>/<song.l8>`.
  // BASE_URL is the one place the `/l8` half is declared (vite `base`); the rest comes out of
  // the address st0 sent us to. React Router only ever writes BELOW its basename, so routes.ts
  // stays written as if the app owned the origin, and the project can no longer be rewritten
  // out of the URL — which is what made a tab need storage to remember it.
  <BrowserRouter
    basename={projectBasename(
      window.location.pathname,
      "l8",
      import.meta.env.BASE_URL,
    )}
  >
    <LocaleProvider>
      <AuthGate>
        {profiling ? (
          <Profiler id="app" onRender={reportCommit}>
            <EngineGate />
          </Profiler>
        ) : (
          <EngineGate />
        )}
      </AuthGate>
    </LocaleProvider>
  </BrowserRouter>,
);
