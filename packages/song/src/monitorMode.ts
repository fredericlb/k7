// An input's `monitor`, read the one way both the graph and the compile read it.
// The schema takes a boolean as well as the tri-state, so `true` is "on" and `false` is "off" everywhere.

export type MonitorMode = "off" | "auto" | "on";

// Undefined when the file says nothing usable; each caller picks its own default for that.
export function monitorMode(v: unknown): MonitorMode | undefined {
  if (typeof v === "boolean") return v ? "on" : "off";
  return v === "off" || v === "auto" || v === "on" ? v : undefined;
}
