import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Gate } from "./Gate";
import "./index.css";

// No StrictMode, matching pistes: its double-mount would fire the engine probe twice on
// every load, and the probe opens real WebSockets.
//
// The router sits OUTSIDE the gate, so a deep link survives signing in: the address is read
// once the library renders, not once the app mounts. `basename` and not a plain root — the app
// is served under studio.test/mediatek, and BASE_URL is the one place that prefix is declared
// (vite `base`). With it set, useLocation() reports paths WITHOUT the prefix, so routes.ts
// stays written as if the app owned the origin.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter basename={import.meta.env.BASE_URL}>
    <Gate />
  </BrowserRouter>,
);
