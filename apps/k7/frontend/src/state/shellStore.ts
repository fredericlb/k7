// shellStore.ts — the shell state panes READ for themselves instead of being handed it: the
// reload signal, the read-only flag, the shell's verbs, the pane gestures, the overlays and
// the view toggles. One store per shell, put in context: the context value is the store, which
// never changes, so a pane re-renders only when what its selector picks does. ../../docs/state.md.

import type { CommandJournal } from "@studio/project-shell/project";
import type { ChangedFile } from "@studio/web-protocol";
import { createContext, useContext } from "react";
import { createStore, type StoreApi, useStore } from "zustand";
import type { SettingsTab } from "../components/SettingsPanel";
import type { MenuCtx } from "../contextMenu";
import type { SetStatus } from "../hooks/useLogs";
import { type Reload, UNKNOWN_RELOAD } from "../reloadScope";
import { type OverlaySlice, overlaySlice } from "./overlaySlice";
import { type PaneCommands, paneCommandsFor } from "./paneCommands";
import { type ToggleSlice, toggleSlice } from "./toggleSlice";

/** What the host implements and the panes call: the store holds stable proxies to it, never the functions themselves. */
export interface ShellVerbs {
  setStatus: SetStatus;
  runCommand: (
    line: string,
    outcome?: { ok: boolean },
    journal?: CommandJournal,
  ) => Promise<void>;
  /** The same line without the reload, for a gesture repeated dozens of times (a knob, a mute). */
  quietCommand: (line: string, journal?: CommandJournal) => Promise<void>;
  openContextMenu: (ctx: MenuCtx, x: number, y: number) => void;
  seek: (seconds: number) => void;
  setLoop: (start: number, end: number, enabled: boolean) => void;
}

export interface ShellState extends OverlaySlice, ToggleSlice {
  /** Which reload counter this host counts — the namespace of its cached reads (queries/). */
  scope: string;
  /** A shared snapshot: nothing here can be written (docs/shared.md). */
  frozen: boolean;
  /** 'Something changed — re-read what you draw', plus WHAT changed (reloadScope.ts). */
  reload: Reload;
  /** The unscoped bump: whatever the caller did, it is not saying what moved. */
  bumpReload: () => void;
  /** The scoped bump: a command's reply says which files it wrote, and `undefined` still means everything. */
  reloadWith: (changed: ChangedFile[] | undefined) => void;
  verbs: ShellVerbs;
  /** The gestures this host offers; a missing one is a handle the pane does not draw. */
  commands: Partial<PaneCommands>;
}

export type ShellStore = StoreApi<ShellState>;

interface ShellOptions {
  scope: string;
  frozen: boolean;
  /** The host's live implementations, read at CALL time — so a pane calling one in its first effect reaches the real thing. */
  impl: { current: ShellVerbs | null };
  /** Which gestures to offer; all of them when absent. */
  commands?: readonly (keyof PaneCommands)[];
  settingsTab?: SettingsTab;
  showHelp?: boolean;
}

/** Proxies that keep one identity for the store's whole life, whatever the host re-creates behind them. */
function proxyVerbs(impl: ShellOptions["impl"]): ShellVerbs {
  return {
    setStatus: (text, level) => impl.current?.setStatus(text, level),
    runCommand: (line, outcome, journal) =>
      impl.current?.runCommand(line, outcome, journal) ?? Promise.resolve(),
    quietCommand: (line, journal) =>
      impl.current?.quietCommand(line, journal) ?? Promise.resolve(),
    openContextMenu: (ctx, x, y) => impl.current?.openContextMenu(ctx, x, y),
    seek: (seconds) => impl.current?.seek(seconds),
    setLoop: (start, end, enabled) =>
      impl.current?.setLoop(start, end, enabled),
  };
}

export function createShellStore(o: ShellOptions): ShellStore {
  const verbs = proxyVerbs(o.impl);
  const all = paneCommandsFor((line) => void verbs.runCommand(line));
  const commands: Partial<PaneCommands> = o.commands
    ? Object.fromEntries(o.commands.map((k) => [k, all[k]]))
    : all;
  return createStore<ShellState>()((set) => ({
    scope: o.scope,
    frozen: o.frozen,
    reload: UNKNOWN_RELOAD,
    bumpReload: () =>
      set((s) => ({ reload: { key: s.reload.key + 1, files: null } })),
    reloadWith: (changed) =>
      set((s) => ({
        reload: { key: s.reload.key + 1, files: changed ?? null },
      })),
    verbs,
    commands,
    ...overlaySlice(set),
    ...toggleSlice(set, {
      settingsTab: o.settingsTab ?? "editor",
      showHelp: o.showHelp ?? false,
    }),
  }));
}

export const ShellStoreContext = createContext<ShellStore | null>(null);

/** The store itself, for a callback that reads it at call time rather than subscribing. */
export function useShellStore(): ShellStore {
  const store = useContext(ShellStoreContext);
  if (!store) throw new Error("useShell: no ShellStoreContext above this pane");
  return store;
}

/** One slice of the shell state; the selector must return a stable value — a primitive, a stored object, never a fresh one. */
export function useShell<T>(selector: (s: ShellState) => T): T {
  return useStore(useShellStore(), selector);
}

/** The shell's verbs, which never change identity. */
export const useVerbs = (): ShellVerbs => useShell((s) => s.verbs);

/** The reload counter alone — what most panes key their reads on. */
export const useReloadKey = (): number => useShell((s) => s.reload.key);
