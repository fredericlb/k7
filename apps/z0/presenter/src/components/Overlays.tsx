// The chrome drawn over the game canvas: the loading card, the waiting chip and the build stamp.
// Sized for a screen read from across a room, which is why they run larger than commons' defaults.

import { Badge } from "@frediverse/ui/badge";
import { Card, CardContent, CardTitle } from "@frediverse/ui/card";
import { m } from "../paraglide/messages.js";

// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set.
const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

export function LoadingOverlay({
  progress,
  loaded,
  total,
}: {
  progress: number;
  loaded: number;
  total: number;
}) {
  const percent = Math.round(progress * 100);
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/85">
      <Card className="flex w-[420px] flex-col items-center gap-5 p-8">
        <CardTitle className="animate-pulse text-3xl tracking-widest">
          CHARGEMENT
        </CardTitle>
        <CardContent className="h-3 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full bg-primary transition-[width] duration-150 ease-out"
            style={{ width: `${percent}%` }}
          />
        </CardContent>
        <span className="text-sm text-muted-foreground tabular-nums">
          {loaded} / {total} sons chargés — {percent}%
        </span>
      </Card>
    </div>
  );
}

export function WaitingForRemote() {
  return (
    <Badge
      variant="tag"
      className="absolute right-6 bottom-5 z-30 animate-pulse px-3 py-1 text-sm tracking-wider"
    >
      {m["game.waitingForRemote"]()}
    </Badge>
  );
}

export function BuildStamp() {
  return (
    <span className="pointer-events-none absolute bottom-5 left-6 z-30 text-xs text-muted-foreground/50 tabular-nums">
      {VERSION}
    </span>
  );
}
