import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Gate } from "./Gate";
import "./index.css";

// No StrictMode, matching l8: its double-mount would fire the engine probe twice on
// every load, and the probe opens real WebSockets.
//
// The router sits OUTSIDE the gate, so a deep link survives signing in: the address is read
// once the library renders, not once the app mounts. `basename` is still BASE_URL rather
// than a hardcoded "/": st0 now owns the origin root so vite sets no `base` and this reads
// "/", but keeping the one declaration is what lets the app be re-prefixed by changing the
// vite config alone. routes.ts is written as if the app owned the origin — which it does.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter basename={import.meta.env.BASE_URL}>
    <Gate />
  </BrowserRouter>,
);
