// mountSite.tsx — the documentation's own host, `docs.<domain>`: the user and developer guides of
// docs-site/, with no gate and no engine. Not the in-app `help` page, which documents k7/docs/ (../../docs/docsSite.md).

import { clearDevPerfEntries } from "@frediverse/ui/dev-perf";
import { serviceUrl } from "@studio/web-protocol/services";
import ReactDOM from "react-dom/client";
import { DocsSite } from "./site/DocsSite";
import "../index.css";

clearDevPerfEntries(import.meta.env.DEV);

const root = document.getElementById("root");
if (root)
  ReactDOM.createRoot(root).render(
    <DocsSite appUrl={serviceUrl(window.location.origin, "k7")} />,
  );
