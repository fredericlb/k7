import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Gate } from "./Gate";
// Imported for its SIDE EFFECT and named here on purpose: it reads `?repo=&project=` at
// import time, and the router below starts rewriting the address as soon as it mounts.
import "@studio/project-shell/launch";
import "./index.css";

// No StrictMode, matching l8 and st0: its double-mount would fire the engine probe
// twice on every load, and the probe opens real WebSockets.
//
// The router sits OUTSIDE the gates, as it does in l8 and st0: the URL names a VIEW of the
// project, and the gates are conditions for reaching it rather than places of their own — so
// a link to /graph survives signing in and resolving the repository.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter basename={import.meta.env.BASE_URL}>
    <Gate />
  </BrowserRouter>,
);
