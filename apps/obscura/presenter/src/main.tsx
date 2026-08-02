import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// vue-router is gone — the presenter has a single route, so App renders the
// view directly; Vite's `base` (/presenter/) still scopes all asset URLs.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
