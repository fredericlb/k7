// useAiOrganize.ts — the builder's half of "AI organize": ask the author what they want, send
// the module to the HOST (which holds the key and the model), and land the answer in the two
// buffers it replaces — the panel and widgets.js. Nothing is written to disk: like every
// builder edit, it waits for Save. The answer is re-checked here, since a host is not trusted
// to have run the same rules. Or copy the same request for a LOCAL Claude Code session, which
// writes the files itself. Rationale: docs/aiOrganize.md.

import { askChoice, askTextAction } from "@studio/project-shell/ask";
import { useCallback, useRef, useState } from "react";
import {
  type AiOrganizeMode,
  type AiOrganizeRequest,
  type AiOrganizeResult,
  type AiParam,
  bindableNames,
  checkAiResult,
  hasLayout,
} from "./aiOrganize";
import { claudeCodePrompt, whereIs } from "./claudeCodePrompt";

/** The dialog's second button: the prompt on the clipboard, for a Claude Code session to write the files. */
const COPY = "claude-code";

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
  uiPath,
  scriptPath,
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
  /** Where the panel and the screens live, workspace-relative — what a copied prompt tells a session to write. */
  uiPath: string | null;
  scriptPath: string | null;
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
    // A panel that lays something out is asked about first: change it, or start again — docs/aiOrganize.md.
    let mode: AiOrganizeMode = "reset";
    if (hasLayout(uiYaml)) {
      const how = await askChoice({
        title: "AI organize",
        body: "This module already has a panel. Update it — Claude changes what you describe and keeps the rest — or reset it, and Claude designs a new one from the parameters alone.",
        choices: [
          { key: "reset", label: "Reset" },
          { key: "update", label: "Update" },
        ],
      });
      if (how === null) return;
      mode = how as AiOrganizeMode;
    }
    // Copying needs to know which file a session is to write; before the panel is read, it cannot say.
    const actions = uiPath
      ? [{ key: COPY, label: "Copy for Claude Code" }]
      : [];
    const asked = await askTextAction(
      mode === "update"
        ? {
            title: "AI organize — update",
            body: "What should change? Claude keeps every widget you do not mention where it is.\nCtrl+Z in the code brings the old panel back.",
            placeholder:
              "e.g. move the filter to its own page, make the cutoff a big knob",
            confirmLabel: "Update",
            actions,
            // An update with nothing to change is a request for nothing.
            validate: (v) => (v.trim() ? "" : "say what should change"),
          }
        : {
            title: "AI organize",
            body: `Claude draws a new panel from the ${params.length} parameters, with screens where a picture helps.${
              uiYaml.trim()
                ? " It REPLACES the panel and widgets.js; Ctrl+Z in the code brings them back."
                : ""
            }\nAnything in particular? Leave empty to let it choose.`,
            placeholder:
              "e.g. one page, a big filter screen, leave the MIDI out",
            confirmLabel: "Organize",
            actions,
          },
    );
    if (asked == null) return;
    const req: AiOrganizeRequest = {
      module,
      moduleYaml,
      params: params.map(({ name, meta, value }) => ({ name, meta, value })),
      uiYaml,
      widgetsJs,
      mode,
      direction: asked.value,
    };
    if (asked.action === COPY && uiPath) {
      const text = claudeCodePrompt(req, {
        ui: uiPath,
        script: canWriteScript ? scriptPath : null,
      });
      try {
        await navigator.clipboard.writeText(text);
        latest.current.setStatus(
          `Prompt copied — paste it into Claude Code in the repository holding ${whereIs(uiPath)}. It writes the file itself; once the change reaches the studio (push, then pull here), the builder's ↻ Refresh shows it.`,
        );
      } catch (e) {
        // No clipboard outside a secure context, or refused: saying so beats a silent nothing.
        latest.current.setStatus(
          `Could not copy the prompt: ${(e as Error).message}`,
        );
      }
      return;
    }
    setBusy("Sending the module…");
    try {
      const res = await call(req, setBusy);
      const { ui, issues } = checkAiResult(
        res,
        bindableNames({ params, moduleYaml }),
        req,
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
    uiPath,
    scriptPath,
  ]);

  return { run: call ? () => void run() : undefined, busy };
}
