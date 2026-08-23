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

/** No caret and no rectangle until a surface says otherwise — a frozen identity, the key listener taking it as a dependency. */
const NO_CONDITIONS: ConditionCtx = {};

/** The `ui` verbs that mean nothing on a one-surface screen and are not worth saying so about — what Esc and Tab fall through to. */
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
  // The one live slice this level draws; NOT the playhead, whose clock subscribes for itself (shellMeta.tsx).
  const playing = useStoreState(store, (s) => s.playing);
  /** Where a fault goes on a screen with no status line — one line in the footer, which is what a phone has room for. */
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

  /** The caret, the zoom and the selection, reported UP by the surface that has them — the conditional bindings read them (keys.ts). */
  const [conditions, setConditions] = useState<ConditionCtx>(NO_CONDITIONS);
  /** The arrangement's handle, when one is mounted — how the caret verbs are answered locally. */
  const timelineRef = useRef<TimelineHandle>(null);
  /** Where the current roll began, in seconds — what ⇧Space goes back to. */
  const replayAt = useRef(0);

  /** The lines this screen answers itself: the bare transport verbs down the socket, the caret verbs to the surface, the rest refused in words. */
  const runLocal = useCallback(
    (line: string): boolean => {
      if (line === "transport replay") {
        // Back to where playback last started, then the bare verb: letting anything re-choose the position would move the replay.
        seek(replayAt.current);
        transport("play");
        return true;
      }
      if (BARE_TRANSPORT.includes(line)) {
        // …falling through to the slow path in the two cases the socket cannot answer for — dropping is right for a disabled button.
        if (!connected || engineBusyRef.current) return false;
        // Where this roll begins, for `replay` above, read before the verb goes; a stop or a rewind is not a start.
        if (line === "transport play" || line === "transport toggle")
          if (!store.getSnapshot().playing)
            replayAt.current = store.getSnapshot().playhead;
        transport(line.slice("transport ".length) as TransportAction);
        return true;
      }
      /** The CARET verbs — the mounted surface's own, through its handle; a surface with no arrangement says so rather than going quiet. */
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
      // The LAYOUT verbs go quiet rather than complaining: they are what Esc and Tab resolve to once nothing is open.
      if (QUIET_UI.has(ui)) return true;
      if (isUiLine(ui)) {
        setStatus(`« ${ui} » appartient à l'éditeur, pas à une surface.`);
        return true;
      }
      return false;
    },
    [connected, engineBusyRef, transport, seek, store],
  );

  /** Running a command, and the reload key every surface here reads — held at THIS level, a second copy being two ages of one project. */
  const commands = useSurfaceCommands(setStatus, runLocal);

  /** The command catalogue and this person's layer over it, fetched once: a remapped play key has to keep working on the tablet. */
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

  /** The line a menu entry PRE-WRITES: ONE footer input, there being no command bar here and no dropping the entries that owe an argument. */
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

  // The song's picture, for the frame — the same call the shell makes, on the key above rather than on the shell's.
  const { doc: videoDoc, error: videoError } = useVideoDoc(commands.reloadKey);
  // …and the tempo the transport clock counts in: the only two fields of the compiled document this level needs.
  const noMidiSeqs = useCallback(() => {}, []);
  const { recInfo } = useProjectDoc(commands.reloadKey, {
    onMidiSeqs: noMidiSeqs,
  });

  // The project's own list, on the same key as everything else here, which is driven by `/revision`.
  const { surfaces } = useSurfaces(commands.reloadKey);
  const surface = useMemo(
    () => surfaces.find((s) => s.id === name) ?? null,
    [surfaces, name],
  );

  // The list arrives a moment after this mounts, so 'not found' has to wait for it.
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
        {/* Play/pause and the clock — the shell's `MiniTransport`; stop, rewind, record and the metronome stay out (../docs/external.md). */}
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
        {/* One line of chrome, not a command BAR: completion and the palette are the shell's, and what makes them worth having is a keyboard. */}
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
        {/* The way back, which is not optional: installed as a PWA this screen has no address bar, so without it the menu is a trap door. */}
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

/** Which component draws this type — `SurfaceTab`'s switch inverted: out here there is no shell, so each is given what it actually needs. */
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
      // No `trackIds`: that list is for a shader's audio input, and building it would mean compiling the song on a device only showing its picture.
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

/** Back to `/external`, as a plain link: this app's basename ends at the PROJECT, so there is no route from here to there. */
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
