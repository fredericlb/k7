// EnginePicker.tsx — which engine this account auditions modules through, in two shapes over
// ONE list: a popover on the header, where it is a setting you may never touch, and the bare
// list, which the Modules gate puts in the way when nothing is chosen yet. Same rows either
// way — a second rendering of the same choice is a second thing to keep in step.

import { Button } from "@frediverse/ui/button";
import type { RankedEngine } from "@studio/engine-browser/probe";
import type { PublicEngine } from "@studio/web-protocol";
import { formatLatency } from "@studio/web-protocol/quality";
import { Check, Server } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** How good the link MEASURED, or null for an engine the registry lists and nothing answered for. */
function where(r: RankedEngine<PublicEngine>): string {
  return r.latency ? formatLatency(r.latency) : "hors de portée";
}

/** The engines as rows; whatever wraps them decides the shape, and `onPicked` is its own business. */
export function EngineList({
  ranked,
  chosenId,
  onChoose,
  onRetry,
  onPicked,
}: {
  ranked: RankedEngine<PublicEngine>[];
  chosenId: string | undefined;
  onChoose: (id: string) => void;
  onRetry: () => void;
  onPicked?: () => void;
}) {
  return (
    <>
      {ranked.length === 0 && (
        <div className="px-2 py-2 text-xs text-muted-foreground">
          {/* Not an error: each service holds its own registry (packages/engine-registry/docs/shared.md). */}
          Aucun moteur ne s'est annoncé à la médiathèque. Dans le capot : « Add
          web UI… ».
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
              onPicked?.();
            }}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
              ok
                ? "hover:bg-accent/50"
                : "cursor-not-allowed text-muted-foreground/60"
            }`}
          >
            <Check
              className={`h-3.5 w-3.5 ${r.engine.id === chosenId ? "" : "invisible"}`}
            />
            <span className="flex-1 truncate">{r.engine.hostname}</span>
            <span className="text-xs text-muted-foreground">{where(r)}</span>
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
    </>
  );
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

  // It OPENS ITSELF only on a genuine question: several reachable, and none remembered.
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
  // The id's head when the chosen engine is not listed: "aucun moteur" would read as a lost choice.
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
          <EngineList
            ranked={ranked}
            chosenId={current ?? undefined}
            onChoose={onChoose}
            onRetry={onRetry}
            onPicked={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
