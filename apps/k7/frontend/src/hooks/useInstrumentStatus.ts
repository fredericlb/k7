// useInstrumentStatus.ts — asks the ENGINE whether the sampled instruments the open project names are on its
// machine, and turns each missing one into an error on the nodes that need it. The engine waits silently for a
// missing one; this is what says so. See engine/k7-supervisor/docs/instruments.md.

import type { EngineClient } from "@studio/engine-browser";
import type { WebProject } from "@studio/web-protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { m } from "../paraglide/messages.js";

/** Asked again this often while one is missing: a download lands without anyone telling k7. */
const RECHECK_MS = 5_000;

const INSTRUMENTS_REF = "@instruments/";

/** Each `@instruments/` ref the document names, with the plugin ids that need it. */
export function instrumentNeeds(
  doc: WebProject | null | undefined,
): Map<string, string[]> {
  const needs = new Map<string, string[]>();
  if (!doc) return needs;
  for (const p of doc.tracks.flatMap((t) => t.plugins)) {
    if (!p.sfzFile?.startsWith(INSTRUMENTS_REF)) continue;
    needs.set(p.sfzFile, [...(needs.get(p.sfzFile) ?? []), p.id]);
  }
  return needs;
}

/** `nbo-wurt` for `@instruments/nbo-wurt/wurly.sfz`: the name the engine's Downloads list shows it by. */
export function instrumentName(ref: string): string {
  return ref.slice(INSTRUMENTS_REF.length).split("/")[0] ?? ref;
}

/** The message per plugin id, for every plugin whose instrument the engine says it has not got. */
export function instrumentWarnings(
  needs: Map<string, string[]>,
  missing: ReadonlySet<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ref of missing)
    for (const id of needs.get(ref) ?? [])
      out[id] = m["engine.instrumentMissing"]({
        instrument: instrumentName(ref),
      });
  return out;
}

export function useInstrumentStatus(
  engineRef: React.RefObject<EngineClient | undefined>,
  connected: boolean,
  doc: WebProject | null | undefined,
  pushLog: (kind: "error", text: string) => void,
  onStatus: (s: string) => void,
): Record<string, string> {
  const needs = useMemo(() => instrumentNeeds(doc), [doc]);
  // A key, so a new document naming the same instruments asks nothing again.
  const refsKey = [...needs.keys()].sort().join("\n");
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  // Said once per instrument while it stays missing, not on every recheck.
  const said = useRef(new Set<string>());

  useEffect(() => {
    const engine = engineRef.current;
    if (!connected || !engine || !refsKey) {
      setMissing(new Set());
      return;
    }
    const refs = refsKey.split("\n");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = engine.onInstrumentStatus((status) => {
      // An answer to another question on this socket names none of ours.
      if (!refs.some((r) => r in status)) return;
      const gone = new Set(refs.filter((r) => status[r] === false));
      setMissing(gone);
      for (const ref of gone)
        if (!said.current.has(ref)) {
          said.current.add(ref);
          const text = m["engine.instrumentMissing"]({
            instrument: instrumentName(ref),
          });
          pushLog("error", `engine: ${text}`);
          onStatus(text);
        }
      for (const ref of said.current)
        if (!gone.has(ref)) said.current.delete(ref);
      clearTimeout(timer);
      if (gone.size)
        timer = setTimeout(() => engine.instrumentStatus(refs), RECHECK_MS);
    });
    engine.instrumentStatus(refs);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [engineRef, connected, refsKey, pushLog, onStatus]);

  return useMemo(() => instrumentWarnings(needs, missing), [needs, missing]);
}
