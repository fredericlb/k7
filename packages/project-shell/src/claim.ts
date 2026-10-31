// claim.ts — when a gate's host may claim the engine for the project its address names: once that
// address has resolved to a project that exists, never before. See docs/launch.md.

import type { GatePhase } from "./gateTypes.ts";

/** The project exists and is going to the engine (`loading`) or on screen (`open`): the only phases a claim may be held in. */
export const projectResolved = (k: GatePhase["k"]): boolean =>
  k === "loading" || k === "open";
