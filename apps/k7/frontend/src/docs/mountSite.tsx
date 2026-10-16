// mountSite.tsx — the documentation's own host, `docs.<domain>`: the help page alone, with no gate,
// no router and no engine. Its Back goes to the app. Its command reference lists only the view
// commands, since the rest comes from a file service this host has none of (../../docs/docsSite.md).

import { clearDevPerfEntries } from "@frediverse/ui/dev-perf";
import { serviceUrl } from "@studio/web-protocol/services";
import ReactDOM from "react-dom/client";
import { HelpPage } from "../components/HelpPage";
import "../index.css";

clearDevPerfEntries(import.meta.env.DEV);
document.title = "k7 — documentation";

const toApp = () => {
  window.location.href = serviceUrl(window.location.origin, "k7");
};

const root = document.getElementById("root");
if (root)
  ReactDOM.createRoot(root).render(
    <div className="h-dvh">
      <HelpPage onBack={toApp} />
    </div>,
  );
