// pages.ts — the docs host's pages: docs-site/ at the repo root, bundled at build time and addressed by path.
// A page's route is its file without `.md` (`user/05-projects.md` → `/user/05-projects`), and an index is
// its folder (`user/00-index.md` → `/user`). Pages keep linking each other with relative `.md` links, so
// they read the same on GitHub; `resolveLink` is what turns those into routes (../../../docs/docsSite.md).

const FILES = import.meta.glob("../../../../../../docs-site/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export type Guide = "user" | "developer";

export const GUIDES: { guide: Guide; label: string }[] = [
  { guide: "user", label: "User guide" },
  { guide: "developer", label: "Developer guide" },
];

export interface SitePage {
  route: string;
  file: string; // relative to docs-site/, which is what the pages' own links resolve against
  guide: Guide | null;
  title: string;
  body: string; // markdown, minus the title line
}

export interface NavGroup {
  label: string;
  items: { label: string; route: string }[];
}

export function routeOf(file: string): string {
  const stem = file.replace(/\.md$/, "");
  if (stem === "index") return "/";
  return `/${stem.replace(/\/00-index$/, "")}`;
}

function parse(file: string, raw: string): SitePage {
  const lines = raw.split("\n");
  const i = lines.findIndex((l) => l.startsWith("# "));
  const head = file.split("/")[0];
  return {
    route: routeOf(file),
    file,
    guide: GUIDES.some((g) => g.guide === head) ? (head as Guide) : null,
    title: i >= 0 ? lines[i].slice(2).trim() : file,
    body: (i >= 0 ? lines.slice(i + 1) : lines).join("\n").trim(),
  };
}

export const SITE_PAGES: SitePage[] = Object.entries(FILES)
  .map(([path, raw]) => parse(path.split("docs-site/")[1], raw))
  .sort((a, b) => a.file.localeCompare(b.file)); // the NN prefix is the order

const BY_FILE = new Map(SITE_PAGES.map((p) => [p.file, p]));
const BY_ROUTE = new Map(SITE_PAGES.map((p) => [p.route, p]));

export function findPage(pathname: string): SitePage | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return BY_ROUTE.get(decodeURI(path));
}

/** A page's relative `.md` link as a route, or null for anything that is not a link to another page. */
export function resolveLink(fromFile: string, href: string): string | null {
  if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) return null;
  const [path, hash] = href.split("#");
  const file = new URL(path, `http://site/${fromFile}`).pathname.slice(1);
  const page = BY_FILE.get(decodeURI(file));
  if (!page) return null;
  return hash ? `${page.route}#${hash}` : page.route;
}

/** A guide's table of contents, read off its index page: each `##` is a group, each `- [label](link)` an entry. */
export function guideNav(guide: Guide): NavGroup[] {
  const index = BY_FILE.get(`${guide}/00-index.md`);
  if (!index) return [];
  const groups: NavGroup[] = [];
  for (const line of index.body.split("\n")) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) groups.push({ label: heading[1].trim(), items: [] });
    const item = /^\s*-\s+\[(.+?)\]\(([^)]+)\)/.exec(line);
    const route = item && resolveLink(index.file, item[2]);
    if (item && route) {
      if (!groups.length) groups.push({ label: "", items: [] });
      groups[groups.length - 1].items.push({ label: item[1], route });
    }
  }
  return groups;
}

/** The pages before and after this one in its guide's order, for the footer. */
export function neighbours(page: SitePage): {
  prev?: SitePage;
  next?: SitePage;
} {
  if (!page.guide) return {};
  const pages = SITE_PAGES.filter((p) => p.guide === page.guide);
  const i = pages.indexOf(page);
  return { prev: pages[i - 1], next: pages[i + 1] };
}
