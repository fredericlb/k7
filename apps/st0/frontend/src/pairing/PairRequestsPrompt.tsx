// PairRequestsPrompt.tsx — on the engine's own machine, one card per LAN device asking to pair:
// its name, its address and the code it shows, with Approve and Deny. Non-blocking, top-right.
// A card leaves when the engine's list drops it, whoever answered (the tray, settings, expiry).

import { Button } from "@frediverse/ui/button";
import { Smartphone } from "@frediverse/ui/icons";
import type { EngineClient, PairRequest } from "@studio/engine-browser";
import { m } from "../paraglide/messages.js";
import { usePairing } from "./usePairing";

export function PairRequestsPrompt({
  engine,
  connected,
}: {
  engine: EngineClient | null | undefined;
  connected: boolean;
}) {
  const { requests } = usePairing(engine, connected);
  if (!engine || !requests.length) return null;
  return (
    <div className="fixed top-14 right-4 z-[60] flex w-80 flex-col gap-2">
      {requests.map((r) => (
        <PairRequestCard key={r.requestId} engine={engine} request={r} />
      ))}
    </div>
  );
}

/** One request, as a card: also what the settings page lists, so both read the same. */
export function PairRequestCard({
  engine,
  request,
}: {
  engine: EngineClient;
  request: PairRequest;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3 text-foreground shadow-lg">
      <div className="flex items-center gap-2 font-medium text-sm">
        <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">
          {m["pairing.requestTitle"]({ name: request.name })}
        </span>
      </div>
      <p className="mt-1 text-muted-foreground text-xs">
        {m["pairing.requestBody"]({ ip: request.ip })}
      </p>
      <div className="mt-2 font-mono text-2xl tracking-[0.3em]">
        {request.code}
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => engine.denyPairing(request.requestId)}
        >
          {m["pairing.deny"]()}
        </Button>
        <Button
          size="sm"
          onClick={() => engine.approvePairing(request.requestId)}
        >
          {m["pairing.approve"]()}
        </Button>
      </div>
    </div>
  );
}
