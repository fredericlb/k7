import { projectBasename } from "@studio/project-shell/launch";
import { Profiler } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthGate } from "./components/AuthGate";
import { EngineGate } from "./components/EngineGate";
import { installFreezeWatchdog, reportCommit } from "./freezeWatchdog";
import { LocaleProvider } from "./i18n";
import "./index.css";

// Report main-thread stalls to the console, so a "random freeze" leaves evidence. Cheap, and console-only.
installFreezeWatchdog();

/**
 * Whether to instrument commits for the watchdog — `?profile=1`, or `studio.profile` in
 * localStorage so it survives the reloads an investigation takes.
 *
 * The Profiler is here for the freeze watchdog, not for tuning: a stall in a React app is
 * usually a COMMIT, and without it the report can only say how long the stall lasted. But it
 * bills EVERY commit in the subtree to record the few over the threshold, and this tree commits
 * on every meter frame — so it is off unless someone is actually looking. See docs/shell.md.
 */
const profiling =
  new URLSearchParams(window.location.search).get("profile") === "1" ||
  localStorage.getItem("studio.profile") === "1";

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
