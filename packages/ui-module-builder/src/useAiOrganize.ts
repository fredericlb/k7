// useAiOrganize.ts — the builder's half of "AI organize": ask the author what they want, send
// the module to the HOST (which holds the key and the model), and land the answer in the two
// buffers it replaces — the panel and widgets.js. Nothing is written to disk: like every
// builder edit, it waits for Save. The answer is re-checked here, since a host is not trusted
// to have run the same rules. Rationale: docs/aiOrganize.md.

import { askText } from "@studio/project-shell/ask";
import { useCallback, useRef, useState } from "react";
import {
  type AiOrganizeRequest,
  type AiOrganizeResult,
  type AiParam,
  checkAiResult,
} from "./aiOrganize";

/** What a host passes to offer the button; absent, the button is not drawn. */
export type AiOrganizeCall = (
  req: AiOrganizeRequest,
  onStatus: (text: string) => void,
) => Promise<AiOrganizeResult>;

export function useAiOrganize({
  call,
  module,
  moduleYaml,
  params,
  uiYaml,
  widgetsJs,
  canWriteScript,
  onPanel,
  onScript,
  setStatus,
}: {
  call?: AiOrganizeCall;
  module: string;
  moduleYaml: string;
  params: readonly AiParam[];
  uiYaml: string;
  widgetsJs: string;
  /** Whether the host serves a widgets.js at all; without one, a screen would have nothing to draw it. */
  canWriteScript: boolean;
  onPanel: (text: string) => void;
  onScript: (text: string) => void;
  setStatus: (s: string) => void;
}): { run?: () => void; busy: string | null } {
  const [busy, setBusy] = useState<string | null>(null);
  // The latest inputs, read when the answer ARRIVES: a minute later, the buffers are these, not the click's.
  const latest = useRef({ onPanel, onScript, setStatus });
  latest.current = { onPanel, onScript, setStatus };

  const run = useCallback(async () => {
    if (!call || busy) return;
    const direction = await askText({
      title: "AI organize",
      body: `Claude draws a new panel from the ${params.length} parameters, with screens where a picture helps.${
        uiYaml.trim()
          ? " It REPLACES the panel and widgets.js; Ctrl+Z in the code brings them back."
          : ""
      }\nAnything in particular? Leave empty to let it choose.`,
      placeholder: "e.g. one page, a big filter screen, leave the MIDI out",
      confirmLabel: "Organize",
    });
    if (direction == null) return;
    setBusy("Sending the module…");
    try {
      const res = await call(
        {
          module,
          moduleYaml,
          params: params.map(({ name, meta, value }) => ({
            name,
            meta,
            value,
          })),
          uiYaml,
          widgetsJs,
          direction,
        },
        setBusy,
      );
      const { ui, issues } = checkAiResult(
        res,
        params.map((p) => p.name),
      );
      if (!ui || issues.length) throw new Error(issues.join("; "));
      const screens = /\btype:\s*lcdscreen\b/.test(res.uiYaml);
      if (screens && !canWriteScript)
        throw new Error(
          "the panel draws screens and this host keeps no widgets.js",
        );
      latest.current.onPanel(res.uiYaml);
      // A panel with no screen leaves widgets.js alone: an emptied stub would be saved as an empty file.
      if (screens) latest.current.onScript(res.widgetsJs);
      latest.current.setStatus(
        res.notes || "AI organize: panel replaced — Save to keep it",
      );
    } catch (e) {
      latest.current.setStatus(`AI organize failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [
    call,
    busy,
    module,
    moduleYaml,
    params,
    uiYaml,
    widgetsJs,
    canWriteScript,
  ]);

  return { run: call ? () => void run() : undefined, busy };
}
