import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { LocaleProvider } from "./lib/i18n";

// LocaleProvider remounts its children on a switch, so nothing rendering a message may sit above it.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
