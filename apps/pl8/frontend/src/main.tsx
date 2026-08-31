import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Gate } from "./Gate";
import "./index.css";
// The waveform's own rules: a plain stylesheet, so `@source` above cannot produce it.
import "@studio/ui-waveform/styles.css";

// No StrictMode: it guarded the engine probe's sockets, and nothing has re-measured it since they went.

// The router sits OUTSIDE the gate, on a `basename` that is BASE_URL (../docs/routing.md).
ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter basename={import.meta.env.BASE_URL}>
    <Gate />
  </BrowserRouter>,
);
