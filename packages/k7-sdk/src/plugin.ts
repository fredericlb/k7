// plugin.ts — the K7Plugin contract: what a feature declares, and nothing it doesn't. A plugin
// is a set of commands, a surface, a set of modules — each contribution here is data that lands
// in a registry that ALREADY existed (commands, surface types, the shell's pane ring), which is
// why the SDK has no runtime of its own. Full rationale: docs/sdk.md.

import type { CommandSpec } from "@studio/commands/commandSpec";
import type { SidHandler } from "@studio/commands/commands";
import type { SurfaceLayout } from "@studio/song-schema/yaml/surfaceSchema";
import type { ReactNode } from "react";

/** One verb, BOTH halves: the catalogue row a palette lists, and the behaviour a dispatch runs.
 *  The installer refuses a half verb — contributing the spec alone would read but never run. */
export interface CommandContribution {
  sid: string;
  spec: CommandSpec;
  handler: SidHandler;
}

/** One kind of surface a project may declare: where it can be drawn, and what each of its
 *  components wants — what `project surface new` scaffolds and the completion provider offers. */
export interface SurfaceTypeContribution {
  type: string;
  layouts: readonly SurfaceLayout[];
  mappingSkeleton: readonly (readonly [string, string])[];
}

/** One surface's drawer, for the shell's pane ring. The PROPS a drawer gets are the shell's to
 *  know — the SDK deliberately does not define them (a drawer is typed where it is MOUNTED, see
 *  docs/sdk.md), so this takes `never`: the bottom type, which any real drawer assigns to. */
export interface PaneDrawerContribution {
  type: string;
  drawer: (props: never) => ReactNode;
}

/** One set of module folders the plugin ships — library modules and dsp-authored ones, served
 *  into the workspace's module library. Data only for now; served on install in a later phase. */
export interface ModuleContribution {
  /** The plugin-qualified ref prefix the folders answer under, e.g. `@transcription/`. */
  namespace: string;
}

export interface K7Plugin {
  /** Stable, namespaced: it prefixes the plugin's SIDs (`plugin.<id>.…`), surface types and
   *  module namespaces, so two plugins cannot collide by accident. */
  id: string;
  commands?: readonly CommandContribution[];
  surfaceTypes?: readonly SurfaceTypeContribution[];
  panes?: readonly PaneDrawerContribution[];
  modules?: readonly ModuleContribution[];
}

/** Identity, for the type it carries: a plugin declares with this so a missing contribution is
 *  a compile error at the declaration, not a missing feature at runtime. */
export const definePlugin = <T extends K7Plugin>(p: T): T => p;
