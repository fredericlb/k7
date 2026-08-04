// pages.ts — the documentation, loaded from the markdown in l8/docs/, so the prose
// lives OUTSIDE the app and reads and diffs like documentation. The filename carries what
// a page needs to place itself (`NN-part-slug.md`) and its first `# heading` is its
// title — a manifest would be a second place to forget to update.

// Bundled at build time (`?raw`): the docs must work with no backend, which is exactly when they are read.
const FILES = import.meta.glob("../../../docs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export type DocPart = "commands" | "syntax" | "technical";

export interface DocPage {
  id: string; // anchor + nav key
  part: DocPart;
  title: string;
  body: string; // markdown, minus the title line
}

const PART_ORDER: DocPart[] = ["commands", "syntax", "technical"];

function parse(path: string, raw: string): DocPage | null {
  const file = path.split("/").pop() ?? "";
  const m = /^(\d+)-([a-z]+)-(.+)\.md$/.exec(file);
  if (!m) return null;
  const [, , part, slug] = m;
  if (!PART_ORDER.includes(part as DocPart)) return null;
  // Title is the first h1, body is the rest — so the page component owns how a heading looks, unrepeated.
  const lines = raw.split("\n");
  const i = lines.findIndex((l) => l.startsWith("# "));
  const title = i >= 0 ? lines[i].slice(2).trim() : slug;
  const body = (i >= 0 ? lines.slice(i + 1) : lines).join("\n").trim();
  return { id: `${part}-${slug}`, part: part as DocPart, title, body };
}

export const DOC_PAGES: DocPage[] = Object.entries(FILES)
  .sort(([a], [b]) => a.localeCompare(b)) // the NN prefix is the order
  .map(([path, raw]) => parse(path, raw))
  .filter((p): p is DocPage => p !== null);

export const DOC_PARTS: { part: DocPart; label: string; pages: DocPage[] }[] =
  PART_ORDER.map((part) => ({
    part,
    label: { commands: "Commands", syntax: "Syntax", technical: "Technical" }[
      part
    ],
    pages: DOC_PAGES.filter((p) => p.part === part),
  })).filter((g) => g.pages.length);
