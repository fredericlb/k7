import { TooltipProvider } from "@frediverse/ui/tooltip";
import { clearDevPerfEntries } from "@studio/project-shell/devPerf";
import { projectBasename } from "@studio/project-shell/launch";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Gate } from "./Gate";
import "./index.css";

// No StrictMode: its double-mount would fire the engine probe twice, and the probe opens sockets.
// React's DEV build leaves a `performance.measure` per render that the browser keeps forever — cleared (st0's docs/shell.md).
clearDevPerfEntries(import.meta.env.DEV);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter
    // The basename carries the project, so no route here can rewrite it away.
    basename={projectBasename(
      window.location.pathname,
      "z0",
      import.meta.env.BASE_URL,
    )}
  >
    <TooltipProvider>
      <Gate />
    </TooltipProvider>
  </BrowserRouter>,
);
