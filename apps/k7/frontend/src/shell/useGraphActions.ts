// useGraphActions.ts — what the graph's gestures run: the `+` on an arrow and the right-click on
// empty canvas (the module picker, then ONE creating line), a file param's asset browser, a
// rack tap's edit, a node's alternative and engine. Every one ends in a command line.

import { TAP_SAMPLE } from "@studio/song-schema/moduleTypes";
import type { TapAction } from "@studio/ui-chains-react";
import { type RefObject, useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { CommandBarHandle } from "../components/CommandBar";
import type { ModulePick, PickerModule } from "../components/ModulePicker";
import {
  createForGraphCommand,
  nodeNewRefArg,
  type PendingInsert,
} from "../nodeInsert";
import { type PendingNode, spawnBox } from "../pendingNode";
import type { ShellStore } from "../state/shellStore";

/** Where the node a CREATING line is about to make should be wired: an arrow or nowhere, plus the world point clicked. */
export interface PendingWire {
  at: PendingInsert | null;
  spawn: { x: number; y: number } | null;
}

export function useGraphActions({
  runCommand,
  runCommandRef,
  prewriteCommand,
  cmdRef,
  reloadKey,
  pendingInsert,
  pendingWire,
  shell,
}: {
  runCommand: (line: string) => Promise<void>;
  /** The latest dispatcher, for the pick: its callback would otherwise rebuild on every command. */
  runCommandRef: RefObject<(line: string) => Promise<void>>;
  prewriteCommand: (text: string) => void;
  cmdRef: RefObject<CommandBarHandle | null>;
  reloadKey: number;
  /** The placeholder the next line draws on its arrow — consumed by `runCommand`. */
  pendingInsert: RefObject<PendingNode | null>;
  /** …and where the node it creates is wired, consumed the same way. */
  pendingWire: RefObject<PendingWire | null>;
  /** The host's shell store — passed, since the host is the one component not under its own provider. */
  shell: ShellStore;
}) {
  /** A node's alternative badge on the graph: switch to that set, or copy the one on — packages/song/docs/alternatives.md. */
  const runAlternative = useCallback(
    (module: string, name: string | null) =>
      void runCommand(
        name === null
          ? `node alternative copy ${module}`
          : `node alternative select ${module} ${name}`,
      ),
    [runCommand],
  );
  /** A node's engine dropdown on the graph: run the module as that engine — packages/song/docs/engines.md. */
  const runEngine = useCallback(
    (module: string, name: string) =>
      void runCommand(`node engine ${module} ${name}`),
    [runCommand],
  );
  // The two pickers are overlays, drawn by ShellOverlays: only their setters are needed here (state/overlaySlice.ts).
  const { setAssetPicker, setModulePicker } = shell.getState();
  const browseAssets = useCallback(
    (module: string, param: string, x: number, y: number, family?: string) => {
      // The choices are the MODULE's own assets/ and its ancestors', re-read from the graph so a file dropped since the last look is offered.
      void api
        .graph()
        .then((g) => {
          const step = Object.values(g.chains ?? {})
            .flatMap((c) => c.use ?? [])
            .find((s) => s.module === module);
          setAssetPicker({
            module,
            param,
            x,
            y,
            files: step?.assetChoices ?? [],
            family,
          });
        })
        .catch(() => {});
    },
    [setAssetPicker],
  );
  /** A rack tap's edit, as the `node tap` command it is — a sample opens the same picker a file param does. */
  const editTap = useCallback(
    (module: string, a: TapAction) => {
      const q = (v: string) => JSON.stringify(v);
      if (a.kind === "note")
        void runCommand(`node tap note ${q(module)} ${q(a.symbol)} ${a.note}`);
      else if (a.kind === "add")
        void runCommand(
          a.note === undefined
            ? `node tap add ${q(module)}`
            : `node tap at ${q(module)} ${a.note}`,
        );
      else if (a.kind === "remove")
        void runCommand(`node tap remove ${q(module)} ${q(a.symbol)}`);
      // A kit's pad is muted on the SFZ player, a rack's on its tap — packages/song/docs/racks.md.
      else if (a.kind === "mute")
        void runCommand(
          a.kit
            ? `node param ${q(module)} ${q(`Mute ${a.note}`)} ${a.on ? 1 : 0}`
            : `node tap mute ${q(module)} ${q(a.symbol)} ${a.on ? "on" : "off"}`,
        );
      else
        void api
          .graph()
          .then((g) => {
            const step = Object.values(g.chains ?? {})
              .flatMap((c) => c.use ?? [])
              .find((s) => s.module === module);
            setAssetPicker({
              module,
              param: TAP_SAMPLE,
              x: a.x,
              y: a.y,
              files: step?.assetChoices ?? [],
              commit: (file) =>
                `node tap sample ${q(module)} ${q(a.symbol)} ${file ? q(file) : "none"}`,
            });
          })
          .catch(() => {});
    },
    [runCommand, setAssetPicker],
  );
  // Offer the click into the pre-written line's `at` field, deferred a tick: a same-tick offer reads the bar's old state.
  const offerSpawnAt = useCallback(
    (at?: { x: number; y: number }) => {
      if (!at) return;
      // Negative is kept, not clamped: above the first lane is where a node belongs as readily as below it (`graph move`).
      const v = `${Math.round(at.x)},${Math.round(at.y)}`;
      setTimeout(() => cmdRef.current?.offer({ at: v }, true), 0);
    },
    [cmdRef],
  );
  // The picker's vocabulary, PREFETCHED once per project — the CATALOGUE and not a list of refs, since only the module says what kind it is.
  const [baseModules, setBaseModules] = useState<PickerModule[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a reload IS the signal to refetch.
  useEffect(() => {
    let alive = true;
    void Promise.all([api.moduleCatalogue(), api.baseModules()])
      .then(([cat, refs]) => {
        if (!alive) return;
        // The project's OWN modules come from the ref list: the picker needs them to know one already exists to instantiate.
        const known = new Set(cat.map((m) => m.ref));
        setBaseModules([
          ...cat.map((m) => ({
            ref: m.ref,
            category: m.category,
            panel: m.panel,
          })),
          ...refs.filter((r) => !known.has(r.ref)),
        ]);
      })
      .catch(() => {}); // the picker falls back to pre-writing the command
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  // Opening the picker awaits nothing; with no vocabulary yet, the command is pre-written instead.
  const insertIntoChain = useCallback(
    (
      info: PendingInsert,
      x: number,
      y: number,
      at: { x: number; y: number } | undefined,
      nameFor: (module: string) => string,
    ) => {
      if (!baseModules.length) {
        prewriteCommand(
          info.stack
            ? `node stack ${info.before} `
            : `node insert ${info.before} ${info.after} `,
        );
        offerSpawnAt(at);
        return;
      }
      setModulePicker({ info, x, y, at, nameFor });
    },
    [baseModules, prewriteCommand, offerSpawnAt, setModulePicker],
  );
  // Right-click on empty canvas: the same picker, but the pick has nowhere to be spliced.
  const placeInGraph = useCallback(
    (
      x: number,
      y: number,
      at: { x: number; y: number } | undefined,
      nameFor: (module: string) => string,
    ) => {
      if (!baseModules.length) {
        // No catalogue to pick from: the person names what to create, and `node new` puts it in the graph.
        prewriteCommand("node new ");
        offerSpawnAt(at);
        return;
      }
      setModulePicker({ info: null, x, y, at, nameFor });
    },
    [baseModules, prewriteCommand, offerSpawnAt, setModulePicker],
  );
  const onModulePick = useCallback(
    (pick: ModulePick) => {
      // Read at pick time: the open picker is the store's, and this callback keeps one identity.
      const modulePicker = shell.getState().modulePicker;
      if (!modulePicker) return;
      setModulePicker(null);
      // A ref wanted, not a node: this project's own module is reached through `@workspace`, like any other ref.
      if (modulePicker.onRef) {
        if (!pick.newCurve)
          modulePicker.onRef(
            pick.namespace === null ? `@workspace/${pick.ref}` : pick.ref,
          );
        return;
      }
      const { info, at, nameFor } = modulePicker;
      // The picker's one non-module offer: a curve has nothing to pick and nothing to splice into, so the bar is prewritten.
      if (pick.newCurve) {
        prewriteCommand("curve new ");
        offerSpawnAt(at);
        return;
      }
      // ONE creating line, then the WIRED half on an arrow (`chainRefFromCreate`) — but an io SOURCE has no input, so it is only PLACED.
      const placed = pick.type === "io";
      const node = nameFor(pick.name);
      // A splice is CENTRED on the `+`, and a pin is a top-left, so the verb is sent the card's corner (docs/chainsGraph.md).
      const box = !placed && info && at ? spawnBox(at, pick.panel) : null;
      const born = box ?? at ?? null;
      // A bare-canvas pick is placed by `node new`'s own spawn pin: the wire half exists only for an arrow.
      pendingWire.current = placed || !info ? null : { at: info, spawn: born };
      // The placeholder on the arrow, while the command runs — the node itself, at the box it will be pinned to.
      pendingInsert.current = box && info ? { ...info, node, ...box } : null;
      const ref = pick.namespace === null ? undefined : pick.ref;
      const spawn = born ? ` ${Math.round(born.x)},${Math.round(born.y)}` : "";
      const created = runCommandRef.current(
        createForGraphCommand(pick.type, pick.name) +
          node +
          nodeNewRefArg(ref) +
          spawn,
      );
      // A camera entry that names its lens, `remote camera`: the node is born, then told which.
      if (pick.camera)
        void created.then(() =>
          runCommandRef.current(`node param ${node} @camera ${pick.camera}`),
        );
      else void created;
    },
    [
      shell,
      setModulePicker,
      prewriteCommand,
      offerSpawnAt,
      pendingInsert,
      pendingWire,
      runCommandRef,
    ],
  );

  return {
    baseModules,
    insertIntoChain,
    placeInGraph,
    onModulePick,
    browseAssets,
    editTap,
    runAlternative,
    runEngine,
  };
}
