import { TooltipProvider } from "@frediverse/ui/tooltip";
import { clearDevPerfEntries } from "@studio/project-shell/devPerf";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { LocaleProvider } from "./lib/i18n";

// LocaleProvider remounts its children on a switch, so nothing rendering a message may sit above it.
// React's DEV build leaves a `performance.measure` per render that the browser keeps forever — cleared (st0's docs/shell.md).
clearDevPerfEntries(import.meta.env.DEV);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </LocaleProvider>
  </StrictMode>,
);
