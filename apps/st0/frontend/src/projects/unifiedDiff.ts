// unifiedDiff.ts — `git diff` text into rows a viewer can draw, each with its old and new line
// numbers. File headers (`diff --git`, `index`, `---`, `+++`) are dropped: the viewer names the file.

export type DiffRow =
  | { kind: "hunk"; text: string }
  | { kind: "add" | "del" | "ctx"; text: string; old?: number; new?: number }
  | { kind: "note"; text: string };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const HEADER =
  /^(diff --git |index |--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode|similarity index|rename from|rename to)/;

export function parseUnifiedDiff(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldN = 0;
  let newN = 0;
  let inHunk = false;
  for (const line of diff.replace(/\n$/, "").split("\n")) {
    const h = HUNK.exec(line);
    if (h) {
      oldN = Number(h[1]);
      newN = Number(h[2]);
      inHunk = true;
      rows.push({ kind: "hunk", text: line });
    } else if (line.startsWith("diff --git ")) inHunk = false;
    else if (!inHunk) {
      if (line && !HEADER.test(line)) rows.push({ kind: "note", text: line });
    } else if (line.startsWith("+"))
      rows.push({ kind: "add", text: line.slice(1), new: newN++ });
    else if (line.startsWith("-"))
      rows.push({ kind: "del", text: line.slice(1), old: oldN++ });
    else if (line.startsWith("\\")) rows.push({ kind: "note", text: line });
    else
      rows.push({ kind: "ctx", text: line.slice(1), old: oldN++, new: newN++ });
  }
  return rows;
}

/** A file git has no earlier version of, drawn as a diff where every line is added. */
export function allAdded(content: string): DiffRow[] {
  const lines = content.replace(/\n$/, "").split("\n");
  return [
    { kind: "hunk", text: `@@ -0,0 +1,${lines.length} @@` },
    ...lines.map((text, i): DiffRow => ({ kind: "add", text, new: i + 1 })),
  ];
}
