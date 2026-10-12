// mountStrip.tsx — the strip's own entry. Everything it may import has to stay small: this
// module and its closure are what a 36-pixel bar costs, and it is mounted in a view of its own
// beside a full editor. See apps/st0-standalone/docs/tabs.md.

import { clearDevPerfEntries } from "@frediverse/ui/dev-perf";
import ReactDOM from "react-dom/client";
import { TabStrip } from "./TabStrip";
import "../index.css";

// No router, no account gate, no service worker: the strip has no address of its own to read
// and nothing to be logged in to.
// React's DEV build leaves a `performance.measure` per render that the browser keeps forever — cleared (st0's docs/shell.md).
clearDevPerfEntries(import.meta.env.DEV);

ReactDOM.createRoot(document.getElementById("root")!).render(<TabStrip />);
