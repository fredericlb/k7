// EngineStatusBar.tsx — the bar at the bottom: which engine this account auditions through
// and how good the link to it is. Q1/Q2/Q3 off a MEASURED latency (the round trip plus what
// the interface costs); see @studio/web-protocol/quality. st0 shows the same line, because it
// describes the session rather than the screen.
//
// It reads `useEngineChoice`, which probes without connecting — so the bar costs no socket
// and no lease of its own. Two connections from one tab is the thing that hook exists to
// avoid; a status bar is not a reason to break it.

import type { EngineLatency } from "@studio/web-protocol/quality";
import { formatLatency } from "@studio/web-protocol/quality";
import { PlugZap } from "lucide-react";
import type { EngineChoice } from "./engine/useEngineChoice";

/** The band decides the colour: Q1 plays, Q2 works, Q3 is for listening rather than playing. */
function tone(l: EngineLatency): string {
  if (l.quality === "Q1") return "text-emerald-500";
  return l.quality === "Q2" ? "text-foreground" : "text-amber-500";
}

export function EngineStatusBar({ choice }: { choice: EngineChoice }) {
  const chosen = choice.ranked.find((r) => r.engine.id === choice.chosenId);
  const name = chosen?.engine.hostname || choice.chosenId?.slice(0, 8);
  return (
    <footer className="flex shrink-0 items-center gap-3 border-t px-3 py-1 text-xs text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1.5">
        <PlugZap className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          {!choice.loaded
            ? "recherche d'un moteur…"
            : name
              ? `moteur ${name}`
              : "aucun moteur choisi"}
        </span>
      </span>
      {choice.loaded && chosen && (
        <span
          className={`whitespace-nowrap font-mono tabular-nums ${
            choice.latency ? tone(choice.latency) : ""
          }`}
          title={
            choice.latency
              ? `${Math.round(choice.latency.networkMs)} ms de réseau + ${Math.round(choice.latency.audioMs)} ms d'interface audio`
              : "ce moteur n'a répondu à aucune adresse depuis ce navigateur"
          }
        >
          {choice.latency ? formatLatency(choice.latency) : "hors de portée"}
        </span>
      )}
    </footer>
  );
}
