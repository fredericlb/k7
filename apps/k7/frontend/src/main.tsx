import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { LocaleProvider } from "./i18n.ts";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  // A basename, so the route table is written as if k7 owned the origin — ../../docs/routing.md.
  <React.StrictMode>
    <LocaleProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </LocaleProvider>
  </React.StrictMode>,
);
