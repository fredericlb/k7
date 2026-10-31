// engineWarnings.ts — an engine warning as a person reads it: a toast in plain words, said once per
// project for the page's life, the engine's own text kept for the log. The engine sends prose and
// no code, so the known kinds are recognised by the stable start of their text (DocJson.cpp,
// EditBuilder.cpp, EngineHost.cpp); a text this does not know still toasts, generically, with the
// raw words after it. See ../docs/shell.md, "Engine warnings are toasts".

import type { EngineWarning } from "@studio/engine-browser";
import { showToast } from "@studio/project-shell/toast";
import { m } from "./paraglide/messages.js";

type Duplicated = "clips" | "tracks" | "modules" | "entries";

/** What a warning is about, read off its text; `unknown` keeps the raw words. */
export type WarningKind =
  | { kind: "duplicateId"; what: Duplicated }
  | { kind: "timeSignature"; signature: string }
  | { kind: "unreadable"; file: string }
  | { kind: "clipMissing"; file: string }
  | { kind: "recordFolder" }
  | { kind: "pluginFailed"; name: string }
  | { kind: "hung" }
  | { kind: "internal" }
  | { kind: "unknown" };

/** The last segment of a path, either slash: the full path stays in the log. */
const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

export function warningKind(message: string): WarningKind {
  let g = /^two (clips|tracks|modules|entries) share the id /.exec(message);
  if (g) return { kind: "duplicateId", what: g[1] as Duplicated };
  g = /^time signature (\S+) cannot be played/.exec(message);
  if (g) return { kind: "timeSignature", signature: g[1] };
  g = /^clip source not found\/invalid: (.+)$/.exec(message);
  if (g) return { kind: "clipMissing", file: fileName(g[1]) };
  g = /^record folder '.*' is outside the folders/.exec(message);
  if (g) return { kind: "recordFolder" };
  g = /^.+? '(.+)' is outside the folders this engine reads/.exec(message);
  if (g) return { kind: "unreadable", file: fileName(g[1]) };
  g = /^could not create plugin '(.+?)'/.exec(message);
  if (g) return { kind: "pluginFailed", name: g[1] };
  if (message.startsWith("the audio engine is hung")) return { kind: "hung" };
  if (/^(background work|an engine job|the state tick) failed/.test(message))
    return { kind: "internal" };
  return { kind: "unknown" };
}

/** The sentence the toast says, in the page's language. */
export function warningSentence(w: EngineWarning): string {
  const k = warningKind(w.message);
  switch (k.kind) {
    case "duplicateId":
      return k.what === "clips"
        ? m["engine.warn.duplicateClip"]()
        : k.what === "tracks"
          ? m["engine.warn.duplicateTrack"]()
          : m["engine.warn.duplicateModule"]();
    case "timeSignature":
      return m["engine.warn.timeSignature"]({ signature: k.signature });
    case "unreadable":
      return m["engine.warn.unreadable"]({ file: k.file });
    case "clipMissing":
      return m["engine.warn.clipMissing"]({ file: k.file });
    case "recordFolder":
      return m["engine.warn.recordFolder"]();
    case "pluginFailed":
      return m["engine.warn.pluginFailed"]({ name: k.name });
    case "hung":
      return m["engine.warn.hung"]();
    case "internal":
      return m["engine.warn.internal"]();
    case "unknown":
      return m["engine.warn.unknown"]({ text: rawText(w) });
  }
}

/** The engine's own words, its subject first: what the log keeps. */
export const rawText = (w: EngineWarning) =>
  w.subject ? `${w.subject}: ${w.message}` : w.message;

/** Whether a warning is new to `scope` (a project's engine session); remembers it if so. */
export function warningSeen(): (scope: string, w: EngineWarning) => boolean {
  const seen = new Set<string>();
  return (scope, w) => {
    const key = `${scope}\n${rawText(w)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

// One memory per page: a reconnect or a re-apply re-raises the same warnings, and a remount must not forget them.
const firstTime = warningSeen();

/** Toast a warning the first time `scope` raises it; true when it was shown. */
export function toastEngineWarning(scope: string, w: EngineWarning): boolean {
  if (!firstTime(scope, w)) return false;
  showToast({ message: warningSentence(w), variant: "warning" });
  return true;
}
