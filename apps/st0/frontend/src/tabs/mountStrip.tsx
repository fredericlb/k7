// mountStrip.tsx — the strip's own entry. Everything it may import has to stay small: this
// module and its closure are what a 36-pixel bar costs, and it is mounted in a view of its own
// beside a full editor. See apps/studio-desktop/docs/tabs.md.

import ReactDOM from "react-dom/client";
import { TabStrip } from "./TabStrip";
import "../index.css";

// No router, no account gate, no service worker: the strip has no address of its own to read
// and nothing to be logged in to.
ReactDOM.createRoot(document.getElementById("root")!).render(<TabStrip />);
