// dispatch.ts — runs a line against the shell's own commands: the `ui` gate first, then the
// one entry the line names. False means "not mine" and the caller sends the line to the server.

import { isUiLine, uiVerdict } from "../../localCommands";
import { m } from "../../paraglide/messages.js";
import type { LocalCtx } from "./context";
import { dispatchKey, findLocal } from "./index";

/** Answer `input` here if it is a shell command; false hands it to the file service (docs/shell.md). */
export function runLocal(ctx: LocalCtx, input: string): boolean {
  // View commands live under `ui`, and the pairing is enforced both ways.
  const prefixed = /^ui\s+/i.test(input);
  const s = prefixed ? input.replace(/^ui\s+/i, "") : input;
  const line = s.toLowerCase();
  const isUi = isUiLine(line);
  // The server's catalogue decides a line that shares a word with a `ui` head: `curve set` is not `ui curve set`.
  const verdict = uiVerdict(line, prefixed, ctx.isServerCommand);
  if (verdict === "refuse") {
    // Handled rather than passed down: the backend has no such command either, and would say less.
    ctx.setStatus(
      isUi
        ? m["status.isUiCommand"]({ line })
        : m["status.notUiCommand"]({ line }),
    );
    return true;
  }
  // …and goes to the server, past every `ui` handler, which would otherwise take it by its first word.
  if (!prefixed && isUi) return false;
  const cmd = findLocal(line, prefixed);
  if (!cmd) return false;
  const at = dispatchKey(cmd).length;
  return cmd.run(ctx, s.slice(at), line.slice(at)) !== false;
}
