// DocsSite.tsx — docs.<domain>: the user guide and the developer guide of docs-site/, one page per address.
// It routes on the pathname itself, with no router: every link on it is a same-origin page or an anchor in one.

import { Button } from "@frediverse/ui/button";
import { ArrowLeft, ArrowRight, ExternalLink } from "@frediverse/ui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { findPage, GUIDES, guideNav, neighbours, type SitePage } from "./pages";
import { SiteMarkdown } from "./SiteMarkdown";

const read = () => ({
  path: window.location.pathname,
  hash: window.location.hash,
});

function useLocation(): { path: string; hash: string } {
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const onPop = () => setLoc(read());
    // Same-origin links are followed in place, so a page change is a render and not a reload.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      if (url.pathname + url.hash !== read().path + read().hash)
        window.history.pushState(null, "", url.pathname + url.hash);
      setLoc({ path: url.pathname, hash: url.hash });
    };
    window.addEventListener("popstate", onPop);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return loc;
}

export function DocsSite({ appUrl }: { appUrl: string }) {
  const { path, hash } = useLocation();
  const address = path + hash;
  const page = findPage(path);
  const nav = useMemo(() => (page?.guide ? guideNav(page.guide) : []), [page]);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = page
      ? `${page.title} — k7 documentation`
      : "k7 documentation";
  }, [page]);

  // A new page starts at its top, or at the heading its address names.
  useEffect(() => {
    const id = decodeURIComponent(address.split("#")[1] ?? "");
    const target = id ? document.getElementById(id) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else body.current?.scrollTo({ top: 0 });
  }, [address]);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3 py-2">
        <a href="/" className="mr-3 shrink-0 text-sm font-semibold">
          k7 docs
        </a>
        {GUIDES.map((g) => (
          <a
            key={g.guide}
            href={`/${g.guide}`}
            aria-current={page?.guide === g.guide ? "true" : undefined}
            className={[
              "shrink-0 rounded px-2 py-1 text-xs hover:bg-accent hover:text-foreground",
              page?.guide === g.guide
                ? "bg-accent text-foreground"
                : "text-muted-foreground",
            ].join(" ")}
          >
            {g.label}
          </a>
        ))}
        <Button asChild variant="secondary" size="sm" className="ml-auto">
          <a href={appUrl} target="_blank" rel="noreferrer">
            Open k7 <ExternalLink className="ml-1 h-3.5 w-3.5" />
          </a>
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {nav.length > 0 && (
          <nav
            aria-label={GUIDES.find((g) => g.guide === page?.guide)?.label}
            className="hidden w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-card/40 p-2 md:flex"
          >
            {nav.map((group) => (
              <div key={group.label} className="flex flex-col">
                {group.label && (
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-foreground/70">
                    {group.label}
                  </div>
                )}
                {group.items.map((item) => (
                  <a
                    key={item.route}
                    href={item.route}
                    aria-current={
                      item.route === page?.route ? "page" : undefined
                    }
                    className={[
                      "rounded px-2 py-1 pl-3 text-xs hover:bg-accent hover:text-foreground",
                      item.route === page?.route
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground",
                    ].join(" ")}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            ))}
          </nav>
        )}

        <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          <article className="mx-auto max-w-3xl pb-24">
            {page ? <Page page={page} /> : <NotFound path={path} />}
          </article>
        </div>
      </div>
    </div>
  );
}

function Page({ page }: { page: SitePage }) {
  const { prev, next } = neighbours(page);
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">{page.title}</h1>
      <SiteMarkdown file={page.file} body={page.body} />
      {(prev || next) && (
        <footer className="mt-12 flex gap-3 border-t border-border pt-4 text-sm">
          {prev && (
            <a
              href={prev.route}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> {prev.title}
            </a>
          )}
          {next && (
            <a
              href={next.route}
              className="ml-auto flex items-center gap-1 text-right text-muted-foreground hover:text-foreground"
            >
              {next.title} <ArrowRight className="h-4 w-4" />
            </a>
          )}
        </footer>
      )}
    </>
  );
}

function NotFound({ path }: { path: string }) {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">No page here</h1>
      <p className="text-sm text-muted-foreground">
        Nothing in the documentation answers <code>{path}</code>.{" "}
        <a href="/" className="underline decoration-dotted">
          Back to the documentation's home
        </a>
        .
      </p>
    </>
  );
}
