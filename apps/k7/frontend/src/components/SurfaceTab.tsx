// SurfaceTab.tsx — one `split` surface, drawn in the pane the shell gives it: k7's half of
// `surfaces/`. It asks the PANE REGISTRY which component draws the type — the desk arrives
// from the turntables plugin, the core panes from the seed — and falls back to a card naming
// where the surface actually draws. The registry refuses a type nothing can declare.
//
// It needs no `open` prop to keep the DOCUMENT alive while the screen is hidden: a pane is
// mounted once and hidden with CSS, and that shell invariant covers it.
//
// See packages/song/docs/surfaces.md and packages/k7-plugins/docs/plugins.md.

import { m } from "../paraglide/messages.js";
import { type ShellPaneProps, shellPaneDrawer } from "../surfacePanes";

export function SurfaceTab({ surface, ...rest }: ShellPaneProps) {
  // The registry answers which component draws this type; a type with no ring slot draws in
  // k7's window, and the card says so — the same rule a device's mount applies.
  const pane = shellPaneDrawer(surface.surface.type);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {pane ? (
        pane({ surface, ...rest })
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          {m["srf.drawnByShell"]({ type: surface.surface.type })}
        </div>
      )}
    </div>
  );
}
