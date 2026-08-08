import { projectBasename } from "@studio/project-shell/launch";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Gate } from "./Gate";
import "./index.css";

// No StrictMode, matching l8, st0 and m9: its double-mount would fire the machine probe twice
// on every load, and the probe opens real WebSockets.
//
// The router sits OUTSIDE the gates, as it does in the others: the URL names a VIEW of the
// project, and the gates are conditions for reaching it rather than places of their own — so a
// link to /edit survives signing in and resolving the repository.
//
// Its basename is the app's mount plus the project — `/v1/<repo>/<cut.v1>`.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter
    basename={projectBasename(
      window.location.pathname,
      "v1",
      import.meta.env.BASE_URL,
    )}
  >
    <Gate />
  </BrowserRouter>,
);
