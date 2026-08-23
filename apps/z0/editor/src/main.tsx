import { projectBasename } from "@studio/project-shell/launch";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Gate } from "./Gate";
import "./index.css";

// No StrictMode: its double-mount would fire the engine probe twice, and the probe opens sockets.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter
    // The basename carries the project, so no route here can rewrite it away.
    basename={projectBasename(
      window.location.pathname,
      "z0",
      import.meta.env.BASE_URL,
    )}
  >
    <Gate />
  </BrowserRouter>,
);
