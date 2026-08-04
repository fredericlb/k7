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
  // basename, not a plain root: the app is served under studio.test/l8, and
  // BASE_URL is the one place that prefix is declared (vite `base`). With it set,
  // useLocation() reports paths WITHOUT the prefix, so the route mapping in
  // routes.ts stays written as if the app owned the origin.
  <BrowserRouter basename={import.meta.env.BASE_URL}>
    <LocaleProvider>
      <AuthGate>
        <Profiler id="app" onRender={reportCommit}>
          <EngineGate />
        </Profiler>
      </AuthGate>
    </LocaleProvider>
  </BrowserRouter>,
);
