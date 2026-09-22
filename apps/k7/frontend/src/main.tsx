import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router-dom";
import App from "./App";
import { PublicPageContainer } from "./containers/PublicPageContainer";
import "./index.css";
import { LocaleProvider } from "./i18n.ts";
import "./styles.css";

// A public page is `/@<nametag>`, matched by hand — ../../docs/pages.md.
const PUBLIC_PAGE = /^\/@([^/]+)\/?$/;

/** Outside <App/> on purpose: App sends an anonymous visitor to login, and a public page must not. */
function Root() {
  const { pathname } = useLocation();
  const publicPage = PUBLIC_PAGE.exec(pathname);
  if (publicPage)
    return <PublicPageContainer nametag={decodeURIComponent(publicPage[1])} />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  // A basename, so the route table is written as if k7 owned the origin — ../../docs/routing.md.
  <React.StrictMode>
    <LocaleProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Root />
      </BrowserRouter>
    </LocaleProvider>
  </React.StrictMode>,
);
