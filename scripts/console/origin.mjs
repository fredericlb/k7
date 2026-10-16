// origin.mjs — which pages may open the console's WebSocket: its own origin, loopback on its port, and STUDIO_CONSOLE_ORIGINS.
// It stops another site open in a LAN browser from driving the shells; it is no guard against a LAN peer, who sends any Origin. See docs/remote.md.

export const CONSOLE_ORIGIN = "https://console.priv.frediver.se";

/** The origins allowed for a console on `port`, plus the comma-separated `extra`. */
export function allowedOrigins(port, extra = "") {
  return new Set([
    CONSOLE_ORIGIN,
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    `http://[::1]:${port}`,
    ...extra
      .split(",")
      .map((o) => o.trim().replace(/\/+$/, "").toLowerCase())
      .filter(Boolean),
  ]);
}

/** Whether an upgrade carrying `origin` may attach; a missing Origin is refused too, since every browser sends one. */
export function originAllowed(origin, allowed) {
  if (typeof origin !== "string" || !origin) return false;
  return allowed.has(origin.replace(/\/+$/, "").toLowerCase());
}
