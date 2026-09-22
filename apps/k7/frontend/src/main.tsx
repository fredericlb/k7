import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import { PublicPageContainer } from "./containers/PublicPageContainer";
import "./index.css";
import { LocaleProvider } from "./i18n.ts";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  // A basename, so the route table is written as if k7 owned the origin — ../../docs/routing.md.
  <React.StrictMode>
    <LocaleProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          {/* Outside <App/> on purpose: App redirects an anonymous visitor to login on mount,
              and a public page must render for one who never signs in. */}
          <Route path="/@:nametag" element={<PublicPageContainer />} />
          <Route path="/*" element={<App />} />
        </Routes>
      </BrowserRouter>
    </LocaleProvider>
  </React.StrictMode>,
);
