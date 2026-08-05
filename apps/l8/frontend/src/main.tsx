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

// The gates before the editor, the router outside them (so a deep link survives sign-in), and NO React.StrictMode
// — its double-mount thrashes the WebGL compositor's context and froze Firefox. See docs/shell.md.
// The Profiler is here for the freeze watchdog, not for tuning: a stall in a React app is usually a COMMIT, and
// without this the report can only say how long it lasted. Only commits over the watchdog's threshold are kept.
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
        <Profiler id="app" onRender={reportCommit}>
          <EngineGate />
        </Profiler>
      </AuthGate>
    </LocaleProvider>
  </BrowserRouter>,
);
