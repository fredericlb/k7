// ExternalSurface.tsx — ONE surface alone, at `<project>/@external/<name>`: what a tablet by the
// decks opens, driving the same engine as the laptop behind it.
//
// Not the shell with things hidden. It mounts the engine link and hands it to whichever of the
// four surface components the declaration names — what the shell adds around a surface is a
// LAYOUT, and none of that is what a surface is made of.
//
// What it DOES add is a footer: the transport, one command line, and the way back.
// See ../docs/external.md.

import type { EngineClient, EngineUrl } from "@studio/engine-browser";
import { PluginParamsStore } from "@studio/engine-browser/params";
import {
  EngineStore,
  EngineStoreProvider,
  useStoreState,
} from "@studio/engine-browser/store";
import type { TransportAction } from "@studio/engine-protocol";
import { externalIndexUrl } from "@studio/project-shell/launch";
import type { ProjectSurface } from "@studio/song-schema/yaml/surfaceFile";
import type { Deck } from "@studio/ui-turntables/engine";
import type { WebVideoProject } from "@studio/web-protocol";
import { ChevronLeft, Loader2, Terminal, Unplug } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, engines } from "../api";
import type { CommandPrefs } from "../commandPrefs";
import { useCommandKeys } from "../hooks/useCommandKeys";
import { useEngineLink } from "../hooks/useEngineLink";
import { useProjectDoc } from "../hooks/useProjectDoc";
import {
  type SurfaceCommands,
  useSurfaceCommands,
} from "../hooks/useSurfaceCommands";
import { useSurfaces } from "../hooks/useSurfaces";
import { useTurntableDeck } from "../hooks/useTurntableDeck";
import { useVideoDoc } from "../hooks/useVideoDoc";
import { type ConditionCtx, effectiveKeys } from "../keys";
import { BARE_TRANSPORT, isUiLine } from "../localCommands";
import { MiniTransport } from "../shellMeta";
import type { CommandInfo } from "../types";
import { ExternalTimeline } from "./ExternalTimeline";
import { MasteringTab } from "./MasteringTab";
import { SurfaceTab } from "./SurfaceTab";
import type { TimelineHandle } from "./TimelineTab";
import { ViewportTab } from "./ViewportTab";

/** No caret and no rectangle until a surface says otherwise — a frozen identity, since the key
 *  listener takes it as a dependency. */
const NO_CONDITIONS: ConditionCtx = {};

/** The `ui` verbs that mean nothing on a one-surface screen and are not worth saying so about:
 *  what Esc and Tab fall through to when there is nothing to close and one pane to focus. */
const QUIET_UI = new Set([
  "close",
  "global",
  "focus next",
  "popin close",
  "slot close",
]);

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
  // The one live slice this level draws. NOT the playhead: the clock subscribes for itself, which
  // is what keeps a ~20 Hz frame from re-rendering the surface under it. See shellMeta.tsx.
  const playing = useStoreState(store, (s) => s.playing);
  /**
   * Where a fault goes on a screen with no status line.
   *
   * The shell has a log panel to put these in; this has none, and inventing one would be
   * inventing the shell. One line in the footer is what a phone has room for.
   */
  const [status, setStatus] = useState("");
  const pushLog = useCallback(() => {}, []);

  const {
    engineRef,
    connected,
    engineReady,
    engineBusyRef,
    transport,
    seek,
    setPluginParam,
    watchPluginParams,
  } = useEngineLink(
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

  /**
   * The caret, the zoom and the selection — reported UP by the surface that has them.
   *
   * The shell derives these from its own state because it holds a caret, a slot and a fullscreen
   * pane; here there is one surface and it holds all there is. The conditional bindings (`m`, `s`,
   * `z`, ⇧L) read them, so a key that would act on nothing goes quiet rather than sending a
   * command with an empty argument. See keys.ts.
   */
  const [conditions, setConditions] = useState<ConditionCtx>(NO_CONDITIONS);
  /** The arrangement's handle, when one is mounted — how the caret verbs are answered locally. */
  const timelineRef = useRef<TimelineHandle>(null);
  /** Where the current roll began, in seconds — what ⇧Space goes back to. */
  const replayAt = useRef(0);

  /**
   * The lines this screen answers itself.
   *
   * Three groups, and each is here for a reason of its own. The four BARE TRANSPORT verbs go
   * straight down the socket, exactly as the shell sends them and for the same measured reason —
   * the file service would send this identical message after an HTTP round trip and an undo
   * journal walk. `replay` joins them, being a seek and a play. The CARET verbs are the mounted
   * surface's and no service can answer them at all. Everything else under `ui` names a pane, a
   * panel or a screen this device does not have, and is refused in words rather than posted to a
   * service that would answer "unknown command".
   */
  const runLocal = useCallback(
    (line: string): boolean => {
      if (line === "transport replay") {
        // Back to where playback last started, and roll again from there. The bare verb after the
        // seek, as the shell does it: letting anything re-choose the position would make replay
        // return somewhere other than where it started.
        seek(replayAt.current);
        transport("play");
        return true;
      }
      if (BARE_TRANSPORT.includes(line)) {
        // …falling through to the slow path in the two cases the socket cannot answer for: no
        // connection of our own, and an engine mid-apply, which this path DROPS rather than
        // queues. Dropping is right for a disabled button and wrong for a key.
        if (!connected || engineBusyRef.current) return false;
        // Where this roll begins, for `replay` above — read before the verb goes, since the
        // playhead is about to move. A stop or a rewind is not a start and does not set it.
        if (line === "transport play" || line === "transport toggle")
          if (!store.getSnapshot().playing)
            replayAt.current = store.getSnapshot().playhead;
        transport(line.slice("transport ".length) as TransportAction);
        return true;
      }
      /**
       * The CARET verbs — the mounted surface's own, answered through its handle.
       *
       * Two of them are `transport` lines and the rest are `ui` ones, which is the shell's split
       * too and not an accident: `t` and ⇧L MOVE the transport, and `ui` promises not to. Both
       * halves reach the same handle.
       *
       * A surface with no arrangement says so rather than going quiet: the key is bound, the
       * command is real, and this device is the wrong place — which is a different thing from a
       * key that does nothing.
       */
      const ui = line.startsWith("ui ") ? line.slice(3).trim() : null;
      const onTimeline: Record<string, (h: TimelineHandle) => void> = {
        "transport locate": (h) => h.seekToCaret(),
        "transport loop": (h) => h.toggleLoop(),
        "ui select": (h) => h.toggleSelect(),
        "ui zoom": (h) => h.zoomIn(),
        "ui zoom out": (h) => h.zoomOut(),
        "ui zoom reset": (h) => h.zoomReset(),
        "ui ruler": (h) => h.toggleRuler(),
        "ui lanes": (h) => h.toggleLanes(),
      };
      const act = onTimeline[line];
      if (act) {
        const h = timelineRef.current;
        if (h) act(h);
        else setStatus(`« ${line} » : cette surface n'a pas d'arrangement.`);
        return true;
      }
      if (ui === null) return false;
      // The LAYOUT verbs go quiet rather than complaining. They are what Esc and Tab resolve to
      // once nothing is open, and a screen that answers Escape with a sentence about the editor
      // is a screen that nags every time you dismiss something.
      if (QUIET_UI.has(ui)) return true;
      if (isUiLine(ui)) {
        setStatus(`« ${ui} » appartient à l'éditeur, pas à une surface.`);
        return true;
      }
      return false;
    },
    [connected, engineBusyRef, transport, seek, store],
  );

  /**
   * Running a command, and the reload key every surface here reads — hooks/useSurfaceCommands.ts.
   *
   * Held at THIS level rather than inside the timeline, though that is the only one writing today:
   * the reload key is also what re-asks the picture, the surfaces list and the compiled document,
   * and a second copy of it would be two screens disagreeing about how old the project is.
   */
  const commands = useSurfaceCommands(setStatus, runLocal);

  /**
   * The command catalogue and this person's layer over it, fetched once.
   *
   * Both are the shell's too. The prefs are what make the KEYMAP this person's — a remapped play
   * key has to keep working on the tablet, or the two screens are two instruments — and they are
   * what the context menu draws its icons and names from.
   */
  const [backendCmds, setBackendCmds] = useState<CommandInfo[]>([]);
  const [commandPrefs, setCommandPrefs] = useState<CommandPrefs>({});
  useEffect(() => {
    void api
      .commands()
      .then(setBackendCmds)
      .catch(() => {});
    void engines
      .prefs()
      .then((p: unknown) =>
        setCommandPrefs((p as { commands?: CommandPrefs })?.commands ?? {}),
      )
      .catch(() => {}); // never saved any: the defaults are the catalogue's own
  }, []);
  const effKeys = useMemo(() => effectiveKeys(commandPrefs), [commandPrefs]);

  /**
   * The line a menu entry PRE-WRITES, and the one place this screen has to put it.
   *
   * A `MenuItem` is either complete — every argument filled by what was clicked, so it runs — or
   * it still owes one, and in the shell those go to the command bar half-typed. There is no
   * command bar here, and inventing one would be inventing the shell; but dropping the entries
   * that owe an argument would take "New alternative…" off a menu whose whole subject is
   * alternatives. So the footer holds ONE input, filled by those entries, opened by the same
   * double-Shift the bar answers to, and typeable in its own right.
   */
  const [line, setLine] = useState("");
  const lineRef = useRef<HTMLInputElement>(null);
  const prewrite = useCallback((command: string) => {
    setLine(command);
    lineRef.current?.focus();
  }, []);
  const focusLine = useCallback(() => lineRef.current?.focus(), []);

  // The same listener the shell runs, on the same keymap — hooks/useCommandKeys.ts.
  useCommandKeys({
    effKeys,
    conditions,
    runCommand: commands.runCommand,
    onDoubleShift: focusLine,
  });

  // The song's picture, for the frame. Asked of every project and empty for most — the same call
  // the shell makes, on the key above rather than on the shell's.
  const { doc: videoDoc, error: videoError } = useVideoDoc(commands.reloadKey);
  // …and the tempo the transport clock counts in. The only two fields of the compiled document
  // this level needs; the surfaces below ask for what they need themselves.
  const noMidiSeqs = useCallback(() => {}, []);
  const { recInfo } = useProjectDoc(commands.reloadKey, {
    onMidiSeqs: noMidiSeqs,
  });

  // The project's own list, on the same key as everything else here — which is driven by
  // `/revision`, so a surface added or renamed in the editor reaches this device rather than
  // leaving it saying "no such surface" until somebody walks over and reloads it.
  const { surfaces } = useSurfaces(commands.reloadKey);
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

  return (
    <EngineStoreProvider value={store}>
      <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
        {/* Play/pause and the clock, above the surface. The shell's own `MiniTransport`, which
            exists for exactly this case — riding over something that is covering the header —
            and it is what a second device most needs: a tablet by the decks is where a hand is,
            and walking back to the laptop to press play is the thing this whole screen is for
            not doing. Stop, rewind, record and the metronome are deliberately absent, being
            decisions about a session you are looking at; the keys still run all of them. */}
        <MiniTransport
          playing={playing}
          waiting={!engineReady}
          tempo={recInfo.tempo}
          beatsPerBar={recInfo.beatsPerBar}
          onToggle={() => void commands.runCommand("transport toggle")}
        />
        <div className="flex min-h-0 flex-1 flex-col">
          <Drawn
            surface={surface}
            project={project}
            store={store}
            engineRef={engineRef}
            seek={seek}
            commands={commands}
            setStatus={setStatus}
            deck={deck}
            paramsStore={pluginParamsStore}
            setPluginParam={setPluginParam}
            watchPluginParams={watchPluginParams}
            videoDoc={videoDoc}
            videoError={videoError}
            prefs={commandPrefs}
            catalogue={backendCmds}
            prewrite={prewrite}
            onConditions={setConditions}
            timelineRef={timelineRef}
          />
        </div>
        {/* One line of chrome. Not a command BAR: no completion, no palette, no catalogue behind
            it — those are the shell's, and what makes them worth having is a keyboard. */}
        <form
          className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            const l = line.trim();
            if (!l) return;
            setLine("");
            void commands.runCommand(l);
          }}
        >
          <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={lineRef}
            value={line}
            onChange={(e) => setLine(e.target.value)}
            placeholder="commande…"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="min-w-0 flex-1 bg-transparent py-0.5 font-mono text-xs outline-none placeholder:text-muted-foreground"
          />
        </form>
        {/* The way back, and what went wrong when something did. The way back is not optional:
            installed as a PWA this screen has no address bar and often no back gesture either,
            so without it the menu is a trap door. */}
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
 * Which component draws this type — the same four the shell's layout mounts, given the same
 * things by a host that is not a layout.
 *
 * The switch is `SurfaceTab`'s inverted, and deliberately so. That one draws the desk and says of
 * the other three that the SHELL draws them, because inside the editor they are panes with the
 * shell's own state behind them. Out here there is no shell, so each is given what it actually
 * needs: the master strip an engine link, the frame a compiled picture, the arrangement its own
 * component (`ExternalTimeline`) because what it needs is a page of wiring.
 */
function Drawn({
  surface,
  project,
  store,
  engineRef,
  seek,
  commands,
  setStatus,
  deck,
  paramsStore,
  setPluginParam,
  watchPluginParams,
  videoDoc,
  videoError,
  prefs,
  catalogue,
  prewrite,
  onConditions,
  timelineRef,
}: {
  surface: ProjectSurface;
  project: string;
  store: EngineStore;
  engineRef: React.RefObject<EngineClient | undefined>;
  seek: (seconds: number) => void;
  commands: SurfaceCommands;
  setStatus: (s: string) => void;
  deck: Deck;
  paramsStore: PluginParamsStore;
  setPluginParam: (id: string, name: string, value: number) => void;
  watchPluginParams: (id: string, on: boolean) => void;
  videoDoc: WebVideoProject | null;
  videoError: string | null;
  prefs: CommandPrefs;
  catalogue: CommandInfo[];
  prewrite: (command: string) => void;
  onConditions: React.Dispatch<React.SetStateAction<ConditionCtx>>;
  timelineRef: React.RefObject<TimelineHandle | null>;
}) {
  switch (surface.surface.type) {
    case "turntables":
      return <SurfaceTab surface={surface} deck={deck} project={project} />;
    case "mastering":
      return (
        <MasteringTab
          surface={surface}
          paramsStore={paramsStore}
          setPluginParam={setPluginParam}
          watchPluginParams={watchPluginParams}
        />
      );
    case "viewport":
      // No `trackIds`: that list exists so a shader's audio input can be looked up in the engine's
      // `levels` array, which is indexed against the compiled track order. Threading it here would
      // mean compiling the song on a device that is only showing its picture — and a shader with
      // no audio input, which is nearly all of them, reads it not at all. See src/shaderAudio.ts.
      return <ViewportTab doc={videoDoc} error={videoError} />;
    case "timeline":
      return (
        <ExternalTimeline
          ref={timelineRef}
          project={project}
          store={store}
          engineRef={engineRef}
          seek={seek}
          commands={commands}
          setStatus={setStatus}
          videoDoc={videoDoc}
          prefs={prefs}
          catalogue={catalogue}
          prewrite={prewrite}
          onConditions={onConditions}
        />
      );
  }
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
