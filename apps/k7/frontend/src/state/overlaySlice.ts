// overlaySlice.ts — what is open OVER the panes: the right-click menu, the pickers, the tap-chain
// and curve popins, the commands page, the assembly builder, the undo confirm. Opened from many
// places (commands, cards, the graph's gestures) and drawn in one (shell/ShellOverlays.tsx).

import type { MenuItem } from "../contextMenu";
import type { MenuTarget } from "../menuTitle";
import type { PendingInsert } from "../nodeInsert";
import type { CurveEdit } from "../ui/commands/context";

/** The right-click menu: its rows, what it is on, and where it opened. */
export interface MenuState {
  items: MenuItem[];
  target?: MenuTarget | null;
  x: number;
  y: number;
}

/** A process step's undo, waiting on the person: the files it restores, and the answer. */
export interface UndoConfirm {
  files: string[];
  label: string;
  resolve: (ok: boolean) => void;
}

/** 'Which file?' — a filepicker widget's asset browser, positioned in the viewport. */
export interface AssetPickerState {
  module: string;
  param: string;
  x: number;
  y: number;
  files: string[];
  /** The library family the widget names, which decides the extensions when the param's name cannot. */
  family?: string;
  /** The command a pick runs, when it is not `node param` — a rack tap's sample is `node tap sample`. */
  commit?: (file: string | null) => string;
}

/** 'Which module?' — `info` is the arrow the pick splices into, NULL when opened on empty canvas. */
export interface ModulePickerState {
  info: PendingInsert | null;
  x: number;
  y: number;
  /** The click's WORLD point — where the picked module will be BORN. */
  at?: { x: number; y: number };
  /** What a node of the picked module lands CALLED, from the pane that holds the graph (ChainsTab's `nameFor`). */
  nameFor: (module: string) => string;
  /** Set when the pick is not a node to place but a ref to hand on — a tap's chain asks for one (TapChainEditor.tsx). */
  onRef?: (ref: string) => void;
}

/** A setter that takes a value or an updater, like React's own. */
export type Setter<T> = (next: T | ((cur: T) => T)) => void;

export interface OverlaySlice {
  menu: MenuState | null;
  setMenu: Setter<MenuState | null>;
  /** The popin on one tap's own chain of effects — `ui tap chain <node> <tap>`. */
  tapChain: { node: string; tap: string } | null;
  setTapChain: Setter<{ node: string; tap: string } | null>;
  modulePicker: ModulePickerState | null;
  setModulePicker: Setter<ModulePickerState | null>;
  /** The curve editor popin (`ui curve [name]`) — docs/curveEditor.md. */
  curveEdit: CurveEdit | null;
  setCurveEdit: Setter<CurveEdit | null>;
  assetPicker: AssetPickerState | null;
  setAssetPicker: Setter<AssetPickerState | null>;
  /** The command catalogue, the one settings screen still drawn as a full PAGE. */
  commandsPage: boolean;
  setCommandsPage: Setter<boolean>;
  /** The assembly TEMPLATE open in its builder. */
  assemblyBuilder: { file: string; folder: string } | null;
  setAssemblyBuilder: Setter<{ file: string; folder: string } | null>;
  /** …and whether it has been unlocked, the confirmation a shared module opens behind. */
  assemblyUnlocked: boolean;
  setAssemblyUnlocked: Setter<boolean>;
  undoConfirm: UndoConfirm | null;
  setUndoConfirm: Setter<UndoConfirm | null>;
}

/** A store's `setState`, narrowed to the slice that calls it. */
export type SliceSet<S> = (fn: (s: S) => Partial<S>) => void;

/** One setter for one key of a store, taking a value or an updater. */
export function setterOf<S, K extends keyof S>(
  set: SliceSet<S>,
  key: K,
): Setter<S[K]> {
  return (next) =>
    set((s) => {
      const value =
        typeof next === "function"
          ? (next as (cur: S[K]) => S[K])(s[key])
          : next;
      return { [key]: value } as unknown as Partial<S>;
    });
}

export function overlaySlice(set: SliceSet<OverlaySlice>): OverlaySlice {
  return {
    menu: null,
    setMenu: setterOf(set, "menu"),
    tapChain: null,
    setTapChain: setterOf(set, "tapChain"),
    modulePicker: null,
    setModulePicker: setterOf(set, "modulePicker"),
    curveEdit: null,
    setCurveEdit: setterOf(set, "curveEdit"),
    assetPicker: null,
    setAssetPicker: setterOf(set, "assetPicker"),
    commandsPage: false,
    setCommandsPage: setterOf(set, "commandsPage"),
    assemblyBuilder: null,
    setAssemblyBuilder: setterOf(set, "assemblyBuilder"),
    assemblyUnlocked: false,
    setAssemblyUnlocked: setterOf(set, "assemblyUnlocked"),
    undoConfirm: null,
    setUndoConfirm: setterOf(set, "undoConfirm"),
  };
}
