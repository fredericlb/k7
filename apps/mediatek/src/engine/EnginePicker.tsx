// EnginePicker.tsx — the médiathèque's first settings surface: which engine this account
// auditions modules through. A popover on the header rather than a screen — it is one
// choice, and a whole page for one row would be a page nobody opens twice.

import { Button } from "@frediverse/ui/button";
import type { RankedEngine } from "@studio/engine-browser/probe";
import type { PublicEngine } from "@studio/web-protocol";
import { Check, Server } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Tier 1 is this machine, 2 is the LAN, 3 is listed but unreachable from this browser. */
function where(r: RankedEngine<PublicEngine>): string {
  if (r.tier === 1) return "cette machine";
  if (r.tier === 2) return "réseau local";
  return "hors de portée";
}

export function EnginePicker({
  ranked,
  chosenId,
  onChoose,
  onRetry,
}: {
  ranked: RankedEngine<PublicEngine>[];
  chosenId: string | undefined;
  onChoose: (id: string) => void;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // It OPENS ITSELF when there is a genuine question: several engines are reachable and
  // none is remembered. One reachable engine is not a choice, and no engine at all is a
  // fact to read — neither deserves a panel in the way.
  const reachable = ranked.filter((r) => r.wsUrl);
  const unanswered =
    reachable.length > 1 && !reachable.some((r) => r.engine.id === chosenId);
  useEffect(() => {
    if (unanswered) setOpen(true);
  }, [unanswered]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const current = chosenId ?? null;
  const chosen = ranked.find((r) => r.engine.id === current);
  // The HOSTNAME when we have it, the id's head when the chosen engine is not in the list
  // — which is the "it is off, or I am on another network" case, and hiding it behind
  // "aucun moteur" would read as a choice that never saved.
  const label = chosen
    ? chosen.engine.hostname
    : current
      ? current.slice(0, 8)
      : "aucun moteur";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50"
      >
        <Server className="h-3.5 w-3.5" />
        {label}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-72 rounded-md border bg-popover p-2 shadow-md">
          <div className="px-2 py-1 text-xs text-muted-foreground">
            Le moteur qui joue les aperçus. Retenu sur votre compte.
          </div>
          {ranked.length === 0 && (
            <div className="px-2 py-2 text-xs text-muted-foreground">
              {/* Not an error: an engine appears here only once its tray has been pointed at
                  the médiathèque, because each service holds its own registry. */}
              Aucun moteur ne s'est annoncé à la médiathèque. Dans le capot : «
              Add web UI… ».
            </div>
          )}
          {ranked.map((r) => {
            const ok = !!r.wsUrl;
            return (
              <button
                key={r.engine.id}
                type="button"
                disabled={!ok}
                onClick={() => {
                  onChoose(r.engine.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                  ok
                    ? "hover:bg-accent/50"
                    : "cursor-not-allowed text-muted-foreground/60"
                }`}
              >
                <Check
                  className={`h-3.5 w-3.5 ${r.engine.id === current ? "" : "invisible"}`}
                />
                <span className="flex-1 truncate">{r.engine.hostname}</span>
                <span className="text-xs text-muted-foreground">
                  {where(r)}
                </span>
              </button>
            );
          })}
          <div className="mt-1 border-t pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs"
              onClick={onRetry}
            >
              Rechercher à nouveau
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
