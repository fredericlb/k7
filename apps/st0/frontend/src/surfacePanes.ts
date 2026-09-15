// surfacePanes.ts — the shell's registry of surface DRAWERS: which component draws a surface
// type, in the two mounts that exist. A plugin contributes one at the shell's composition point
// (plugins.ts); the four builtins are the seed, so the builtins are simply the first plugins.
// Full rationale: packages/st0-sdk/docs/sdk.md.

import type { EngineClient } from "@studio/engine-browser";
import type { PluginParamsStore } from "@studio/engine-browser/params";
import type { EngineStore } from "@studio/engine-browser/store";
import type { ProjectSurface } from "@studio/song-schema/yaml/surfaceFile";
import { allSurfaceTypes } from "@studio/song-schema/yaml/surfaceRegistry";
import type { Deck } from "@studio/ui-turntables/engine";
import type { WebVideoProject } from "@studio/web-protocol";
import type { ReactNode } from "react";
import type { CommandPrefs } from "./commandPrefs";
import type { TimelineHandle } from "./components/TimelineTab";
import type { SurfaceCommands } from "./hooks/useSurfaceCommands";
import type { ConditionCtx } from "./keys";
import type { CommandInfo } from "./types";

/** What a surface's DEVICE mount gets — the whole ctx, this shell's invariants (ExternalSurface).
 *  A `never` drawer (the SDK's contribution shape) assigns to this, which is the whole join. */
export interface DeviceSurfaceCtx {
  surface: ProjectSurface;
  /** Workspace-relative, as every file route takes it. */
  project: string;
  /** Where the LIBRARY answers — pl8 holds the master (apps/pl8/docs/stems.md). */
  libraryBase: string;
  /** The project's change token — the shell's ONE poll, shared with every consumer. */
  rev: string | null;
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
}

/** …and what a surface's PANE mount gets — the ring slot's three, which the pane builds on
 *  (SurfaceTab's shape): it fetches its own graph and derives its own engine and library. */
export interface ShellPaneProps {
  surface: ProjectSurface;
  deck: Deck;
  project: string;
  /** Where the LIBRARY answers — pl8 holds the master (apps/pl8/docs/stems.md). */
  libraryBase: string;
  /** The project's change token — the shell's ONE poll, shared with every consumer. */
  rev: string | null;
  /** The video surface's needs, which the shell holds: the compiled picture, its load error,
   *  the track order a shader's audio input reads, the share's readOnly, the armed lane. */
  videoDoc: WebVideoProject | null;
  videoError: string | null;
  trackIds: readonly string[];
  readOnly: boolean;
  videoArmed: string | null;
}

export type DeviceSurfaceDrawer = (ctx: DeviceSurfaceCtx) => ReactNode;
export type ShellPaneDrawer = (props: ShellPaneProps) => ReactNode;

export interface SurfacePaneContribution {
  type: string;
  /** The ring slot's drawer — absent when the type draws nowhere in the shell's panes yet. */
  pane?: ShellPaneDrawer;
  /** A device's drawer — absent when the type draws only in st0's window. */
  device?: DeviceSurfaceDrawer;
}

const panes = new Map<string, SurfacePaneContribution>();

/** Contribute a surface's drawers. A builtin's name is not free, and a type the SCHEMA has never
 *  heard of is refused too: a drawer for a type no project can declare is a drawer drawn by
 *  nobody — the registry checks the type against the schema's own list, so the type is
 *  contributed first (a plugin's surface types), then the drawer. */
export function registerSurfacePane(c: SurfacePaneContribution): void {
  if (panes.has(c.type))
    throw new Error(`surface type '${c.type}' already has a pane`);
  if (!allSurfaceTypes().includes(c.type))
    throw new Error(
      `surface type '${c.type}' is not registered — contribute it to the surface registry first`,
    );
  panes.set(c.type, c);
}

/** A device's drawer for the type, or undefined — the caller draws the "drawn by the shell" card. */
export function deviceSurfaceDrawer(
  type: string,
): DeviceSurfaceDrawer | undefined {
  return panes.get(type)?.device;
}

/** The ring slot's drawer for the type, or undefined — the shell keeps its own core panes. */
export function shellPaneDrawer(type: string): ShellPaneDrawer | undefined {
  return panes.get(type)?.pane;
}
