import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Gate } from "./Gate";
import "./index.css";
// The waveform's own wrapper/marker rules. A plain stylesheet, not Tailwind, so `@source`
// above cannot produce it — it has to be imported like any other CSS file.
import "@studio/ui-waveform/styles.css";

// No StrictMode, matching l8: its double-mount would fire the engine probe twice on
// every load, and the probe opens real WebSockets.
//
// The router sits OUTSIDE the gate, so a deep link survives signing in: the address is read
// once the library renders, not once the app mounts. `basename` is BASE_URL and never a
// literal, which is what let this app be re-prefixed by editing the vite config alone: it read
// "/" while pl8 answered the origin root and reads "/pl8/" now that l8 does. routes.ts is
// written as if the app owned the origin, and react-router keeps that true by stripping the
// basename off everything it hands back.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter basename={import.meta.env.BASE_URL}>
    <Gate />
  </BrowserRouter>,
);
