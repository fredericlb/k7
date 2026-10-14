// examples.ts — pull every YAML example back out of the documentation markdown, so the
// checkable part is recovered from the prose rather than duplicated beside it. A fenced
// block declares itself in its INFO STRING (`yaml schema=Track`, or `yaml exempt="why"`);
// a plain ```yaml with neither FAILS, since silence is how an unchecked example gets in.

import { DOC_PAGES } from "./pages";

export interface DocExample {
  where: string; // "syntax-tracks · tracks/<id>.yaml — audio", for a test name
  code: string;
  schema?: string;
  exempt?: string;
  /** The prose around it — the coverage check counts a field named in either. */
  context: string;
}

// ```<info>\n<code>\n``` — non-greedy so consecutive blocks don't merge.
const FENCE = /^```yaml([^\n]*)\n([\s\S]*?)^```$/gm;
const SCHEMA = /\bschema=([A-Za-z]+)/;
const EXEMPT = /\bexempt="([^"]*)"/;

function examplesIn(page: (typeof DOC_PAGES)[number]): DocExample[] {
  const out: DocExample[] = [];
  for (const m of page.body.matchAll(FENCE)) {
    const [full, info, code] = m;
    // The nearest heading above the block names it — what a reader would call it is what a failure should say.
    const before = page.body.slice(0, m.index ?? 0);
    const heading = [...before.matchAll(/^#{2,3} (.+)$/gm)].pop()?.[1];
    out.push({
      where: `${page.id} · ${heading ?? page.title}`,
      code,
      schema: SCHEMA.exec(info)?.[1],
      exempt: EXEMPT.exec(info)?.[1],
      // Everything between heading and block: the sentence that introduces it often names a field in prose.
      context: before.slice(before.lastIndexOf(heading ?? "")) + full,
    });
  }
  return out;
}

export const DOC_EXAMPLES: DocExample[] = DOC_PAGES.flatMap(examplesIn);
