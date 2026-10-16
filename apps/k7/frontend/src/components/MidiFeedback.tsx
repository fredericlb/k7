// MidiFeedback.tsx — the MIDI feedback pass, a component that renders null so the per-frame param
// values reach the controller without re-rendering the graph. See ../../docs/midi.md.

import {
  type PluginParamsStore,
  usePluginParams,
} from "@studio/engine-browser/params";
import { useEffect } from "react";

export function MidiFeedback({
  store,
  push,
}: {
  store: PluginParamsStore;
  push: (live: Record<string, Record<string, number>>) => void;
}) {
  const live = usePluginParams(store);
  useEffect(() => push(live), [live, push]);
  return null;
}
