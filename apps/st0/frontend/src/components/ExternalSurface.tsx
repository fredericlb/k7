// ExternalSurface.tsx — ONE surface, on its own, at `<project>/@external/<name>`. What another
// device opens: a tablet by the decks driving the same engine as the laptop behind them.
//
// Not the shell with things hidden — the shell with nothing else in it would still be the shell,
// and every pane, panel and key belongs to a screen this device is not showing. So this mounts
// the two things a surface actually needs, both of them the hooks App uses: the engine link and
// the deck. The surface itself is the same component the pane draws (`SurfaceTab`).
//
// See ../docs/external.md.

import type { EngineUrl } from "@studio/engine-browser";
import { PluginParamsStore } from "@studio/engine-browser/params";
import { EngineStore, EngineStoreProvider } from "@studio/engine-browser/store";
import { externalIndexUrl } from "@studio/project-shell/launch";
import { ChevronLeft, Loader2, Unplug } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useEngineLink } from "../hooks/useEngineLink";
import { useSurfaces } from "../hooks/useSurfaces";
import { useTurntableDeck } from "../hooks/useTurntableDeck";
import { SurfaceTab } from "./SurfaceTab";

/** What a surface has to BE for another device to be worth handing it. See below. */
const REMOTE_TYPES = new Set(["turntables"]);

/** The same question the share panel asks before offering a link, so the two cannot drift:
 *  every surface HAS an address, and this is the one that answers on a second device. */
export const isRemotable = (type: string): boolean => REMOTE_TYPES.has(type);

export function ExternalSurface({
  name,
  project,
  engineUrl,
  userEmail,
}: {
  /** The surface's id, off the address — `@external/<name>`. */
  name: string;
  /** Workspace-relative, as every file route here takes it. */
  project: string;
  engineUrl: EngineUrl;
  userEmail: string;
}) {
  const store = useRef(new EngineStore()).current;
  const pluginParamsStore = useRef(new PluginParamsStore()).current;
  /**
   * Where a fault goes on a screen with no status line.
   *
   * The shell has a footer and a log panel to put these in; this has neither, and inventing them
   * would be inventing the shell. One line under the surface is what a phone has room for.
   */
  const [status, setStatus] = useState("");
  const pushLog = useCallback(() => {}, []);

  const { engineRef, engineReady, watchPluginParams } = useEngineLink(
    engineUrl,
    userEmail,
    store,
    pluginParamsStore,
    setStatus,
    pushLog,
  );

  const deck = useTurntableDeck({
    store,
    engineRef,
    engineReady,
    watchPluginParams,
    pluginParamsStore,
    engineUrl,
  });

  // The project's own list, polled like the shell's — a surface added or renamed while a tablet
  // is open should reach it too, rather than leaving a screen that says "no such surface" until
  // somebody reloads the device across the room.
  const [reloadKey] = useState(0);
  const { surfaces } = useSurfaces(reloadKey);
  const surface = useMemo(
    () => surfaces.find((s) => s.id === name) ?? null,
    [surfaces, name],
  );

  // The list arrives a moment after this mounts, so "not found" has to wait for it — otherwise
  // every external link says "no such surface" for a frame before drawing.
  if (!surfaces.length && !surface)
    return (
      <Centre>
        <Loader2 className="h-5 w-5 animate-spin" />
      </Centre>
    );

  if (!surface)
    return (
      <Centre>
        <Unplug className="h-8 w-8" aria-hidden="true" />
        <p className="max-w-sm text-center text-sm">
          Aucune surface « {name} » dans ce projet.
        </p>
        <p className="max-w-sm text-center text-xs opacity-70">
          Les surfaces sont les fichiers de <code>surfaces/</code> ; l'adresse
          en nomme une par son nom de fichier.
        </p>
        <Back />
      </Centre>
    );

  /**
   * Not every surface is worth another device, and the two that are not say so.
   *
   * A `timeline` and a `viewport` are drawn by the SHELL, from state only it holds — the caret,
   * the zoom stack, the video document, the pane ring. Standing them up here would be standing
   * up the shell, which is the thing this screen exists not to be. The desk is the one that was
   * always meant to leave the desk: it is a set of controls over an engine, and `SurfaceTab`
   * already draws it from a declaration and a link.
   *
   * Said out loud rather than drawn empty, and named as a limit rather than as an error: the
   * address is right, the surface exists, and this device is the wrong place for it.
   */
  if (!REMOTE_TYPES.has(surface.surface.type))
    return (
      <Centre>
        <Unplug className="h-8 w-8" aria-hidden="true" />
        <p className="max-w-sm text-center text-sm">
          Une surface « {surface.surface.type} » ne se commande pas à distance.
        </p>
        <p className="max-w-sm text-center text-xs opacity-70">
          Elle est dessinée par l'éditeur, à partir de ce que seul l'éditeur
          tient — le curseur, le zoom, l'image. Ouvrez le projet.
        </p>
        <Back />
      </Centre>
    );

  return (
    <EngineStoreProvider value={store}>
      <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
        <div className="min-h-0 flex-1">
          <SurfaceTab surface={surface} deck={deck} project={project} />
        </div>
        {/* The only chrome: the way back, and what went wrong when something did. No header, no
            transport, no pane row — this device is holding one surface and the surface has its
            own. The way back is not optional though: installed as a PWA this screen has no
            address bar and often no back gesture either, so without it the menu is a trap door. */}
        <footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1">
          <Back />
          {status ? (
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {status}
            </p>
          ) : null}
        </footer>
      </div>
    </EngineStoreProvider>
  );
}

/**
 * Back to `/external`, as a plain link.
 *
 * Not a router one: this app is mounted under a basename that ends at the PROJECT, and the menu
 * sits above every project — there is no route from here to there, only an address.
 */
function Back() {
  return (
    <a
      href={externalIndexUrl(window.location.origin, "st0")}
      title="Toutes les surfaces"
      className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-accent"
    >
      <ChevronLeft className="h-4 w-4" />
      Surfaces
    </a>
  );
}

/** The one layout this screen has besides the surface: something centred, on its own. */
function Centre({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-muted-foreground">
      {children}
    </div>
  );
}
