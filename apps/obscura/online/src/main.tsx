import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { LocaleProvider } from "./lib/i18n";

// LocaleProvider sits above App: switching language remounts its children, so
// nothing that renders a message may live above it.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
