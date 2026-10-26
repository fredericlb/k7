// useEngineCompat.ts — how compatible the engine playing this tab is with the OPEN project,
// for the engine selector's warning (BarEngine). Re-asked when the project changes, since adding a
// module can add a plugin. The same two roads as ../engineCompat.ts: files on the SERVER are
// scored here, against the catalogue this tab's engine lists once per connection; files on the
// ENGINE'S MACHINE are scored by that machine's file service, against its own engine's scan.

import type { EngineClient } from "@studio/engine-browser";
import {
  type CataloguePlugin,
  type Compatibility,
  compatibility,
  type PluginNeed,
} from "@studio/engine-browser/compat";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

/** Null until it is known — which draws no warning, rather than a false one. */
export function useEngineCompat(
  engineRef: React.RefObject<EngineClient | undefined>,
  connected: boolean,
  project: string | null,
  /** The project's change token: a new one re-asks. */
  rev: string | null,
  /** Whether the files are the SERVER's (hosted) or live beside the engine. */
  hosted: boolean,
): Compatibility | null {
  const [needs, setNeeds] = useState<PluginNeed[] | null>(null);
  const [catalogue, setCatalogue] = useState<CataloguePlugin[] | null>(null);
  const [scored, setScored] = useState<Compatibility | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `rev` is a trigger, not a value read here — it says WHEN to re-ask.
  useEffect(() => {
    // Kept across a re-ask, so the warning does not blink while the project is re-read.
    if (!project) {
      setNeeds(null);
      setScored(null);
      return;
    }
    let alive = true;
    if (hosted)
      api
        .projectPlugins(project)
        .then((r) => alive && setNeeds(r.plugins))
        .catch(() => {});
    else
      api
        .projectCompat(project)
        .then((r) => alive && setScored(r.compat))
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [project, rev, hosted]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!hosted || !connected || !engine) return;
    // The engine BROADCASTS its answer, so another client's filtered `system plugins` could arrive
    // too: the first reply after our own ask is the one taken.
    let asked = true;
    const off = engine.onPlugins((list) => {
      if (!asked) return;
      asked = false;
      setCatalogue(list);
    });
    engine.listPlugins();
    return off;
  }, [hosted, connected, engineRef]);

  return useMemo(
    () =>
      hosted
        ? needs && catalogue
          ? compatibility(needs, catalogue)
          : null
        : scored,
    [hosted, needs, catalogue, scored],
  );
}
