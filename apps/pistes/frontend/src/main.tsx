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
  <BrowserRouter>
    <LocaleProvider>
      <AuthGate>
        <Profiler id="app" onRender={reportCommit}>
          <EngineGate />
        </Profiler>
      </AuthGate>
    </LocaleProvider>
  </BrowserRouter>,
);
