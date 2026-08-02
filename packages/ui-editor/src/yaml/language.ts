// language.ts (yaml) — the language support for the editor's project files.
//
// `@codemirror/lang-yaml` brings a real lezer tree — the same tree the completions use
// to find the cursor (keyPath.ts), rather than a second scanner.

import { yaml } from "@codemirror/lang-yaml";
import {
  HighlightStyle,
  type LanguageSupport,
  syntaxHighlighting,
} from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

/** Is this path one of the YAML project files? */
export const isYamlFile = (path?: string): boolean =>
  /\.ya?ml$/i.test(path ?? "");

// The colours are the editor's own CSS variables, shared with the rest of the app.
const yamlHighlight = HighlightStyle.define([
  { tag: t.comment, color: "var(--sh-muted-foreground)", fontStyle: "italic" },
  { tag: t.string, color: "var(--sh-green)" },
  { tag: t.number, color: "var(--sh-amber)" },
  { tag: t.bool, color: "var(--sh-amber)" },
  { tag: t.null, color: "var(--sh-amber)" },
  // A mapping key is what you read a project file for — it gets the accent.
  { tag: t.definition(t.propertyName), color: "var(--sh-primary)" },
  { tag: t.propertyName, color: "var(--sh-primary)" },
  { tag: t.punctuation, color: "var(--sh-muted-foreground)" },
  { tag: t.meta, color: "var(--sh-muted-foreground)" },
]);

/** The language support for a project file. */
export function projectLanguage(): LanguageSupport | Extension[] {
  return [yaml(), syntaxHighlighting(yamlHighlight)];
}
