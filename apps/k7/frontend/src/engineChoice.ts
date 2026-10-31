// engineChoice.ts — the gate's engine list and its pick, for the bar's engine dropdown under it:
// the gate owns the probe and the remount a switch costs, the dropdown only draws them. Null
// outside a gate (a share), where there is no engine to change. See ../docs/shell.md.

import { createContext, useContext } from "react";
import type { RankedEngine } from "./types";

export interface EngineChoice {
  ranked: RankedEngine[];
  /** A probe is running. */
  loading: boolean;
  refresh: () => void;
  pick: (r: RankedEngine) => void;
  /** The full list over the page: pairing a device, every badge in words. */
  openList: () => void;
  /** Somebody else holds the claim: the link hangs up and stays down — ../docs/shell.md, "When somebody else takes the engine". */
  detached?: boolean;
}

export const EngineChoiceContext = createContext<EngineChoice | null>(null);

export const useEngineChoice = (): EngineChoice | null =>
  useContext(EngineChoiceContext);
