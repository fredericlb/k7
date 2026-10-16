// widgetScript.ts — React's reading of the widget sandbox: a script's shape and a panel's
// `visible` answer, each the LAST KNOWN answer, re-rendering once when a new one lands.
// Before any answer a card shows every widget: a hidden one appearing late beats one never shown.
// The sandbox itself is @studio/ui-chains/widgetSandbox; the why is docs/lcdScreen.md.

import type { PanelFrame } from "@studio/ui-chains/lcdScreen";
import {
  type ScriptInfo,
  type WidgetSandbox,
  widgetSandbox,
} from "@studio/ui-chains/widgetSandbox";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const EMPTY: ReadonlySet<string> = new Set();

/** The sandbox's rebuild count: a screen's canvas must be a new element after each one. */
export function useSandboxGeneration(sb: WidgetSandbox): number {
  return useSyncExternalStore(sb.subscribe, sb.getGeneration, sb.getGeneration);
}

/** A script's draws, pointers and error; undefined until the sandbox has answered once. */
export function useScriptInfo(
  source: string | undefined,
): ScriptInfo | undefined {
  const sb = widgetSandbox();
  const gen = useSandboxGeneration(sb);
  const [got, setGot] = useState<{ source: string; info: ScriptInfo }>();
  const cached = source ? sb.peekInfo(source) : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `gen` re-asks after a rebuild, since the dead frame's answer is lost.
  useEffect(() => {
    if (!source || sb.peekInfo(source)) return;
    let live = true;
    sb.info(source).then((info) => {
      if (live && info) setGot({ source, info });
    });
    return () => {
      live = false;
    };
  }, [sb, source, gen]);
  if (!source) return undefined;
  return cached ?? (got?.source === source ? got.info : undefined);
}

/** The widget ids `visible` hides for this panel, or null for a module with no script. */
export function useHiddenWidgets(
  source: string | undefined,
  panel: PanelFrame,
): ReadonlySet<string> | null {
  const sb = widgetSandbox();
  const gen = useSandboxGeneration(sb);
  const key = source ? sb.visibleKey(source, panel) : "";
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const lastRef = useRef<ReadonlySet<string>>(EMPTY);
  const [, landed] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `gen` re-asks after a rebuild, since the dead frame's answer is lost.
  useEffect(() => {
    if (!source || !key || sb.peekHidden(key)) return;
    let live = true;
    // The answer goes into the sandbox's cache; this only re-renders to read it, once.
    sb.hidden(source, panelRef.current).then((h) => {
      if (live && h) landed((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [sb, source, key, gen]);
  if (!source) return null;
  const shown = sb.peekHidden(key) ?? lastRef.current;
  lastRef.current = shown;
  return shown;
}
