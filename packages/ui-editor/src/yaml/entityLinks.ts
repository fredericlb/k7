// entityLinks.ts — clickable entity references: a dotted underline on a name that resolves
// to a file, ctrl-click to open it. Which fields link comes from `hints.paths`; the VALUES
// come from the syntax tree (entityValues.ts), the same source the completions use — one
// grammar answering both, rather than two scanners agreeing by luck.

import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { Hints } from "@studio/web-protocol";
import { keyTokens, valueTokens } from "./entityValues";

const joinPath = (base: string, rel: string) => {
  const parts = [base, ...rel.split("/")].filter(Boolean);
  return parts.join("/");
};

// A reference field -> the entity kinds a string value there may name (priority order).
const FIELD_KINDS: Record<string, string[]> = {
  ref: ["clip", "sequence"],
  module: ["module"],
  use_rack: ["module"], // a sequence's rack link — names a (rack) module
  extends: ["base"], // the module this one extends — a base-module ref (type/name)
  track: ["track", "chain"],
  in: ["track", "chain", "clip", "sequence"],
};

/** chains.yaml's sections, which key by ENTITY rather than by field name — see docs/completion.md. */
const SECTION_KINDS: Record<string, { keys?: string[]; values: string[] }> = {
  tracks: { keys: ["track"], values: ["module", "sink"] },
  modules: { keys: ["module"], values: ["module", "sink"] },
  bypassed: { values: ["module"] },
};

function firstPath(
  hints: Hints,
  kinds: string[],
  value: string,
): string | null {
  for (const k of kinds) {
    const rel = hints.paths?.[`${k}:${value}`];
    if (rel) return joinPath(hints.projectRoot, rel);
  }
  return null;
}

function resolvePath(
  hints: Hints,
  field: string | null,
  keyPath: string[],
  value: string,
): string | null {
  // The section wins where there is one: inside `modules:` a key called `in` is a module named "in".
  const section = SECTION_KINDS[keyPath[0] ?? ""];
  if (section) return firstPath(hints, section.values, value);
  const kinds = field ? FIELD_KINDS[field] : undefined;
  return kinds ? firstPath(hints, kinds, value) : null;
}

/** Every span resolving to a file: the values, plus the KEYS of the chains sections, since a module may be only a key. */
export function linkTargets(
  state: EditorState,
  hints: Hints,
): { from: number; to: number; path: string }[] {
  const out: { from: number; to: number; path: string }[] = [];
  for (const t of valueTokens(state)) {
    const path = resolvePath(hints, t.field, t.keyPath, t.value);
    if (path && t.to > t.from) out.push({ from: t.from, to: t.to, path });
  }
  for (const t of keyTokens(state)) {
    const kinds = SECTION_KINDS[t.keyPath[0] ?? ""]?.keys;
    // Only a SECTION's own entries: `tracks:` itself is a key inside no section, and names nothing.
    if (!kinds || t.keyPath.length !== 1) continue;
    const path = firstPath(hints, kinds, t.key);
    if (path && t.to > t.from) out.push({ from: t.from, to: t.to, path });
  }
  // A RangeSetBuilder takes its ranges in document order, and the two passes interleave.
  return out.sort((a, b) => a.from - b.from);
}

const linkMark = (path: string) =>
  Decoration.mark({
    class: "entity-link",
    attributes: { "data-entity-path": path, title: `open ${path}` },
  });

const linkTheme = EditorView.theme({
  ".entity-link": {
    textDecoration: "underline dotted",
    textUnderlineOffset: "2px",
    cursor: "pointer",
  },
  ".entity-link:hover": {
    textDecoration: "underline solid",
    cursor: "pointer",
  },
});

/** Linkify the entity references in a project file. */
export function projectEntityLinks(
  hints: Hints,
  onOpen: (path: string) => void,
): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged)
          this.decorations = this.build(u.view);
      }
      build(view: EditorView): DecorationSet {
        const b = new RangeSetBuilder<Decoration>();
        for (const l of linkTargets(view.state, hints))
          b.add(l.from, l.to, linkMark(l.path));
        return b.finish();
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousedown(e) {
          const el = (e.target as HTMLElement)?.closest?.(
            ".entity-link",
          ) as HTMLElement | null;
          const path = el?.getAttribute("data-entity-path");
          if (path && (e.ctrlKey || e.metaKey)) {
            e.preventDefault(); // open instead of moving the caret
            onOpen(path);
            return true;
          }
          return false;
        },
      },
    },
  );
  return [plugin, linkTheme];
}
