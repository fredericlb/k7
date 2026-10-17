# The documentation's own host

`docs.k7.rocks` (`docs.priv.k7.rocks` in dev) is the documentation SITE: the user guide and the
developer guide in `docs-site/` at the repository root, readable by someone who has no account and
no engine. The host is decided in `packages/web-protocol/docs/addresses.md`; this page covers what
the frontend does with it.

## The same SPA, a third entry

The docs host is routed to k7's container and served k7's bundle, unchanged. `main.tsx` reads the
hostname before anything else (`isDocsHost`) and imports `src/docs/mountSite.tsx` instead of the
app — the same dispatch that keeps the tab strip from loading the editor. `src/docs/site/pages.ts`
globs `docs-site/` at build time, so the host needs no server of its own, no build of its own and
no copy of the pages. The backend already answers every path that is not `/api`, `/auth` or
`/assets/` with `index.html`, which is all a deep link here needs.

The page mounts no `AuthGate`, no router and no engine gate. **Open k7** goes to the app's origin,
`serviceUrl(origin, "k7")`, which reads `docs.` as `app.`.

## Not the in-app help

The `help` command opens `HelpPage`, which renders `apps/k7/docs/` — the commands, the file
formats, the generated command reference — beside an open project. The docs host serves the
guides instead: they cover the whole of k7 for a reader who is not inside it yet, and the in-app
page's command reference comes from a file service this host has none of.

## Pages are addressed by their file

A page's address is its path in `docs-site/` without `.md`, and a guide's `00-index.md` is the
guide's own address (`/user`, `/developer`). The files link each other with relative `.md` links,
so they read the same on GitHub; the site rewrites those links into addresses as it renders, and
gives every heading GitHub's anchor id, which is what their `#…` links were written against.

A guide's sidebar is read off its `00-index.md` — each `##` a group, each list link an entry — so
adding a page means listing it there, and there is no second manifest to forget.

`src/docs/site/pages.test.ts` follows every link between the pages and every anchor, and counts
the pages, since an empty glob would otherwise leave the host blank and the link check vacuous.
