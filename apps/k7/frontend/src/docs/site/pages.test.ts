// Does every link between the docs host's pages land on a page, and every anchor on a heading of it?
// Reads docs-site/ through the same glob the host serves, so an empty glob fails the count rather than passing vacuously.

import { marked } from "marked";
import { describe, expect, it } from "vitest";
import { findPage, GUIDES, guideNav, resolveLink, SITE_PAGES } from "./pages";
import { slugify } from "./SiteMarkdown";

function links(body: string): string[] {
  const out: string[] = [];
  marked.walkTokens(marked.lexer(body), (t) => {
    if (t.type === "link") out.push(t.href);
  });
  return out;
}

function anchors(body: string): Set<string> {
  const out = new Set<string>();
  marked.walkTokens(marked.lexer(body), (t) => {
    if (t.type === "heading")
      out.add(slugify(marked.parseInline(t.text) as string));
  });
  return out;
}

describe("the docs host", () => {
  it("bundles the home page and both guides", () => {
    expect(SITE_PAGES.length).toBeGreaterThan(100);
    expect(findPage("/")?.file).toBe("index.md");
    for (const g of GUIDES) {
      expect(findPage(`/${g.guide}`)?.file).toBe(`${g.guide}/00-index.md`);
      expect(guideNav(g.guide).length).toBeGreaterThan(3);
    }
  });

  it("resolves every relative link to a page, and every anchor to a heading", () => {
    const broken: string[] = [];
    for (const page of SITE_PAGES) {
      for (const href of links(page.body)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
        // `{ hole }` and its kind are placeholders inside a syntax example, not links.
        if (!/\.md(#|$)|^#/.test(href)) continue;
        const route = href.startsWith("#")
          ? `${page.route}${href}`
          : resolveLink(page.file, href);
        const [path, hash] = (route ?? "").split("#");
        const target = route ? findPage(path) : undefined;
        if (!target) broken.push(`${page.file} → ${href}`);
        else if (hash && !anchors(target.body).has(hash))
          broken.push(`${page.file} → ${href} (no such heading)`);
      }
    }
    expect(broken).toEqual([]);
  });
});
