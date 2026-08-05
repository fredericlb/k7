import { projectBasename } from "@studio/project-shell/launch";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Gate } from "./Gate";
import "./index.css";

// No StrictMode, matching l8 and st0: its double-mount would fire the engine probe
// twice on every load, and the probe opens real WebSockets.
//
// The router sits OUTSIDE the gates, as it does in l8 and st0: the URL names a VIEW of the
// project, and the gates are conditions for reaching it rather than places of their own — so
// a link to /graph survives signing in and resolving the repository.
//
// Its basename is the app's mount plus the project — `/m9/<repo>/<set.m9>` — exactly as in
// l8's main.tsx, and for the reason given there.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter
    basename={projectBasename(
      window.location.pathname,
      "m9",
      import.meta.env.BASE_URL,
    )}
  >
    <Gate />
  </BrowserRouter>,
);
