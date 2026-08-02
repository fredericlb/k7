import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

// No StrictMode, matching lanes and mediatek: its double-mount would fire the engine probe
// twice on every load, and the probe opens real WebSockets.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
