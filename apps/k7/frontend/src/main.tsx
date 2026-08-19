import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { LocaleProvider } from "./i18n.ts";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  // basename, not a plain root, exactly as in l8, m9 and pl8: the app is served
  // under st0.priv.frediver.se/k7, and BASE_URL is the one place that prefix is declared
  // (vite `base`). Without it every navigate() writes a bare /sessions, which
  // belongs to pl8 — the app kept working until you reloaded, and then you landed
  // in the médiathèque. With it set, useLocation() reports paths WITHOUT the
  // prefix, so navForPath and the route table stay written as if k7 owned the origin.
  <React.StrictMode>
    <LocaleProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </LocaleProvider>
  </React.StrictMode>,
);
