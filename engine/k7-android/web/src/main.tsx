import { PORTS_GLOBAL } from "@studio/web-protocol/services";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { LOCAL_PORTS } from "./native";
import "./index.css";

// Before anything derives an address: the phone's own studio is a loopback one, told apart by its port.
(globalThis as Record<string, unknown>)[PORTS_GLOBAL] = LOCAL_PORTS;

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
