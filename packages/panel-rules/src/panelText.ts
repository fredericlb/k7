// panelText.ts — a module's panel as the k7x text of its `ui.k7x`, each widget on ONE line.
// The one-line widget is what keeps moving a knob a one-line diff, so every writer of a panel prints through here.

import type { K7Path } from "@studio/k7x/ast";
import { stringify } from "@studio/k7x/print";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Whether a node to print is one widget of a `widgets` map, the thing kept on one line. */
export const isWidgetAt = (path: K7Path, value: unknown): boolean =>
  path.length >= 2 &&
  path[path.length - 2] === "widgets" &&
  isRecord(value) &&
  typeof value.type === "string";

/** A whole `ui.k7x` for a panel's plain data, headed by `//` lines. */
export const panelFileText = (
  panel: Record<string, unknown>,
  header: readonly string[] = [],
): string => stringify(panel, { header, inline: isWidgetAt });
