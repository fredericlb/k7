// chainsTypes.ts — what a host hands the chains graph and hears back from it: the sink's play
// button, the context-menu target, the icon set and the parked camera. The icons travel by
// context, provided by DomChains itself — docs/hosting.md.

import type { WebCc, WebModuleCategory } from "@studio/graph-model";
import { createContext, useContext } from "react";
import type { Cam } from "./camera";

/** A play button on the SINK node, opt-in and absent by default — docs/hosting.md. */
export interface SinkPlay {
  playing: boolean;
  /** No engine, or nothing to play. `title` is what says which. */
  disabled?: boolean;
  title?: string;
  onToggle: () => void;
}

export type GraphMenuCtx =
  | { kind: "track"; id: string }
  | {
      kind: "module";
      id: string;
      missing?: boolean;
      model?: boolean;
      native?: boolean;
    }
  | { kind: "chain"; id: string }
  | { kind: "sink"; id: string }
  // A BOX right-clicked: the instance, and the template behind it — a host may offer either.
  | { kind: "assembly"; id: string; uses: string }
  // A rack PAD right-clicked: the node whose kit it is, and the sound — what every `node tap …` verb takes.
  | { kind: "tap"; id: string; symbol: string }
  // A CURVE CARD right-clicked: the curve, and the param it drives when the card is a binding rather than a free curve.
  | { kind: "curve-card"; curve: string; module?: string; param?: string }
  // One WIDGET right-clicked: the param it drives, and the CC already mapped to it.
  | {
      kind: "param";
      /** The module the widget is drawn on. */
      id: string;
      /** The widget's `bind`, verbatim — `Cutoff`, or `@monitor` for a module field. */
      param: string;
      /** Its label, for a menu that reads as the knob does. */
      label: string;
      /** The CC bound to it today, if any (the module's `controller.k7x`). */
      cc?: WebCc;
      /** A curve drives it today — what makes removing the automation an entry. */
      automated?: boolean;
    };

/** The glyphs a node draws itself with, supplied by the host — docs/hosting.md. */
export interface ChainsIcons {
  ModuleIcon: (props: {
    category?: WebModuleCategory;
    missing?: boolean;
    className?: string;
    style?: React.CSSProperties;
  }) => React.ReactNode;
  /** Whether a category HAS a glyph, so a node knows to leave room for one. */
  moduleGlyph: (category?: WebModuleCategory, missing?: boolean) => unknown;
  TrackIcon: (props: {
    name: string;
    video?: boolean;
    color?: string;
    className?: string;
    style?: React.CSSProperties;
  }) => React.ReactNode;
  /** A track's name WITHOUT the instrument code its glyph already says — the host's, like the glyphs (docs/hosting.md). */
  trackLabel?: (name: string) => string;
}

// Carried by context, not by props, and provided by DomChains itself — docs/hosting.md.
export const IconsContext = createContext<ChainsIcons | null>(null);

export function useIcons(): ChainsIcons {
  const v = useContext(IconsContext);
  if (!v) throw new Error("DomChains rendered without its icons");
  return v;
}

/** Where a host parks the camera between mounts — docs/hosting.md. */
export type CamStore = React.MutableRefObject<Cam | null>;
