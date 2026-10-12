// PairThisDevice.tsx — the card a LAN device sees when an engine answered it but refuses it until
// paired: one button asks, the code to check on the machine is shown big, and the outcome after.
// Drawn only while no engine is usable; a revoked key lands here too, the probe having forgotten it.

import { Button } from "@frediverse/ui/button";
import { KeyRound, Loader2 } from "@frediverse/ui/icons";
import {
  type PairingOutcome,
  requestPairing,
} from "@studio/engine-browser/pairing";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import type { RankedEngine } from "../types";

/** The engines that answered this device and want it paired first — the ones a card is drawn for. */
export function needingPairing(ranked: RankedEngine[]): RankedEngine[] {
  return ranked.filter((r) => r.needsPairing && r.wsUrl);
}

type Step =
  | { k: "idle" }
  | { k: "asking"; code: string | null }
  | { k: "done"; outcome: Exclude<PairingOutcome, "paired"> };

export function PairThisDevice({
  engine,
  onPaired,
}: {
  engine: RankedEngine;
  /** Re-probe: the key is stored by now, so the engine answers as usable. */
  onPaired: () => void;
}) {
  const [step, setStep] = useState<Step>({ k: "idle" });
  const host = engine.engine.hostname || engine.engine.id.slice(0, 8);

  const ask = async () => {
    if (!engine.wsUrl) return;
    setStep({ k: "asking", code: null });
    const outcome = await requestPairing(
      engine.wsUrl,
      engine.engine.id,
      (code) => setStep({ k: "asking", code }),
    );
    if (outcome === "paired") {
      setStep({ k: "idle" });
      onPaired();
    } else setStep({ k: "done", outcome });
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-4">
      <div className="flex items-center gap-2 font-medium text-sm">
        <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">
          {m["pairing.notPaired"]({ host })}
        </span>
      </div>
      {step.k === "asking" ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">
            {m["pairing.approveOnMachine"]()}
          </p>
          {step.code ? (
            <div className="text-center font-mono text-4xl tracking-[0.3em]">
              {step.code}
            </div>
          ) : null}
          <span className="inline-flex items-center gap-2 text-muted-foreground text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {m["pairing.waiting"]()}
          </span>
        </div>
      ) : (
        <>
          {step.k === "done" ? (
            <p className="text-amber-500 text-xs">
              {outcomeText(step.outcome)}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              {m["pairing.explain"]()}
            </p>
          )}
          <div>
            <Button size="sm" onClick={() => void ask()}>
              {step.k === "done"
                ? m["pairing.retry"]()
                : m["pairing.pairThisDevice"]()}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function outcomeText(o: Exclude<PairingOutcome, "paired">): string {
  if (o === "denied") return m["pairing.denied"]();
  if (o === "expired") return m["pairing.expired"]();
  return m["pairing.failed"]();
}
