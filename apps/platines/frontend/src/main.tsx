import ReactDOM from "react-dom/client";
import { Gate } from "./Gate";
import "./index.css";

// No StrictMode, matching pistes and mediatek: its double-mount would fire the engine probe
// twice on every load, and the probe opens real WebSockets.
ReactDOM.createRoot(document.getElementById("root")!).render(<Gate />);
