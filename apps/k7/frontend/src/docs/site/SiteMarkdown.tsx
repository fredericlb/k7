// SiteMarkdown.tsx — one docs-site page as HTML: headings get GitHub's anchor ids, `.md` links become routes.
// dangerouslySetInnerHTML is safe for the reason Markdown.tsx gives: the input is docs-site/, bundled at build time.

import { Marked, type Tokens } from "marked";
import { useMemo } from "react";
import { resolveLink } from "./pages";

/** GitHub's heading anchor, which is what the pages' `#…` links were written against. */
export function slugify(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&[#\w]+;/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    heading({ tokens, depth }) {
      const inner = this.parser.parseInline(tokens);
      return `<h${depth} id="${slugify(inner)}">${inner}</h${depth}>\n`;
    },
    link({ href, tokens }) {
      if (!/^https?:/.test(href)) return false;
      const inner = this.parser.parseInline(tokens);
      return `<a href="${href}" target="_blank" rel="noreferrer">${inner}</a>`;
    },
  },
});

function render(file: string, body: string): string {
  const tokens = marked.lexer(body);
  marked.walkTokens(tokens, (t) => {
    if (t.type !== "link") return;
    const route = resolveLink(file, (t as Tokens.Link).href);
    if (route) (t as Tokens.Link).href = route;
  });
  return marked.parser(tokens);
}

export function SiteMarkdown({ file, body }: { file: string; body: string }) {
  const html = useMemo(() => render(file, body), [file, body]);
  return (
    // Prose styles scoped here, as in Markdown.tsx, one size up: this page is read, not glanced at beside an editor.
    <div
      className={[
        "text-sm leading-relaxed text-muted-foreground",
        "[&_h2]:mb-2 [&_h2]:mt-8 [&_h2]:scroll-mt-4 [&_h2]:border-b [&_h2]:border-border/60 [&_h2]:pb-1 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground",
        "[&_h3]:mb-1 [&_h3]:mt-6 [&_h3]:scroll-mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground",
        "[&_h4]:mb-1 [&_h4]:mt-4 [&_h4]:scroll-mt-4 [&_h4]:font-semibold [&_h4]:text-foreground",
        "[&_p]:my-3",
        "[&_strong]:font-semibold [&_strong]:text-foreground",
        "[&_a]:text-foreground [&_a]:underline [&_a]:decoration-dotted [&_a]:underline-offset-2",
        "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6",
        "[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6",
        "[&_li]:my-1",
        "[&_code]:rounded [&_code]:bg-muted/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground",
        "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/40 [&_pre]:p-3",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[12px] [&_pre_code]:leading-snug",
        "[&_table]:my-3 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:border-collapse",
        "[&_th]:border-b [&_th]:border-border [&_th]:py-1.5 [&_th]:pr-4 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground",
        "[&_td]:border-b [&_td]:border-border/40 [&_td]:py-1.5 [&_td]:pr-4 [&_td]:align-top",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic",
      ].join(" ")}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
