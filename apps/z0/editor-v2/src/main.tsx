import { projectBasename } from "@studio/project-shell/launch";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Gate } from "./Gate";
import "./index.css";

// No StrictMode, matching st0, m9 and pl8: its double-mount would fire the engine probe twice
// on every load, and the probe opens real WebSockets.
//
// The router's basename is this SPA's mount plus the project — `/z0/editor-v2/<repo>/<x.z0>`.
// React Router only ever writes below its basename, so no route of this app can rewrite the
// project away; a reload re-reads the address. See packages/project-shell/docs/launch.md.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter
    basename={projectBasename(
      window.location.pathname,
      "z0",
      import.meta.env.BASE_URL,
    )}
  >
    <Gate />
  </BrowserRouter>,
);
