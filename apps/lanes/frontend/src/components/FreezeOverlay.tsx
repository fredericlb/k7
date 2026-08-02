// FreezeOverlay.tsx — the modal wait while a track is being frozen.
//
// Deliberately intrusive, which is unusual here: everything else that takes time in lanes reports itself in
// place (the play button's spinner, a busy engine, a module's warning badge) precisely so the app stays usable.
// A freeze is the exception. It bounces the track in a separate engine process, which can run for as long as the
// song is; the transport has just been stopped under the user; and when it lands, a lane's contents and a whole
// chain's modules change at once. Anything the user started in the meantime would be aimed at a project that no
// longer looks like that. So the app takes the wait, says which track and why, and gives it back.

import { Loader2, Snowflake } from "lucide-react";

export function FreezeOverlay({ track }: { track: string }) {
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      role="alertdialog"
      aria-busy="true"
      aria-label={`freezing ${track}`}
    >
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-lg border border-border bg-card px-8 py-6 text-center shadow-lg">
        <div className="relative flex h-10 w-10 items-center justify-center">
          <Loader2 className="absolute h-10 w-10 animate-spin text-sky-400/40" />
          <Snowflake className="h-5 w-5 text-sky-400" />
        </div>
        <div className="text-sm font-medium">
          Freezing <span className="font-mono">{track}</span>
        </div>
        {/* What it is doing and what it costs, in one line: the render's length is the song's, so "a moment" would
            be an underestimate on anything long and the user would start wondering if it had hung. */}
        <div className="text-xs text-muted-foreground">
          Rendering the track through its modules. Playback is stopped; this
          takes about as long as the song is.
        </div>
      </div>
    </div>
  );
}
