import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { LocaleProvider } from "./lib/i18n";

// LocaleProvider goes ABOVE App rather than inside it. Switching language
// remounts the provider's children, which re-runs their message lookups — but a
// message resolved in the same render as the provider belongs to the parent,
// which doesn't re-render, and would keep the old language. Mounting at the
// root leaves nothing above it that renders text.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
