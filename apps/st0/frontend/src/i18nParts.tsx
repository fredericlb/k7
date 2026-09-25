// i18nParts.tsx — a translated sentence with something CLICKABLE in the middle. A compiled message
// is one string, so a link inside one would otherwise mean cutting the sentence in two and letting
// each language keep English word order. Here the message keeps its holes and the host fills them.
// See docs/shell.md.

import type { ReactNode } from "react";

/** What a hole is rendered as while the string is being cut up — NUL, which no catalogue string holds. */
const MARK = "\u0000";

/**
 * Fill a message's named holes with nodes:
 *
 *   parts((h) => m["repos.empty"](h), { new: <b>New</b>, import: <b>Import</b> })
 *
 * Each hole carries its NAME through the string, so a language that puts them in another order
 * still gets the right node in each.
 */
export function parts<K extends string>(
  render: (holes: Record<K, string>) => string,
  nodes: Record<K, ReactNode>,
): ReactNode[] {
  const holes = {} as Record<K, string>;
  for (const k of Object.keys(nodes) as K[]) holes[k] = `${MARK}${k}${MARK}`;
  return (
    render(holes)
      .split(new RegExp(`${MARK}([A-Za-z]+)${MARK}`))
      // Odd positions are the captured NAMES, even ones the text between them.
      .map((piece, i) =>
        i % 2 ? (
          <span key={`${piece}-${i}`}>{nodes[piece as K]}</span>
        ) : (
          <span key={`t-${i}`}>{piece}</span>
        ),
      )
  );
}
