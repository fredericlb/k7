import { clearDevPerfEntries } from "@studio/project-shell/devPerf";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// A single route, so App renders the view directly; Vite's `base` still scopes every asset URL.
// React's DEV build leaves a `performance.measure` per render that the browser keeps forever — cleared (st0's docs/shell.md).
clearDevPerfEntries(import.meta.env.DEV);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
