# The documentation's own host

`docs.k7.rocks` (`docs.priv.k7.rocks` in dev) is k7's documentation with nothing else around it:
the same pages the `help` command opens over a project, readable by someone who has no account and
no engine. The host is decided in `packages/web-protocol/docs/addresses.md`; this page covers what
the frontend does with it.

## The same SPA, a third entry

The docs host is routed to k7's container and served k7's bundle, unchanged. `main.tsx` reads the
hostname before anything else (`isDocsHost`) and imports `src/docs/mountSite.tsx` instead of the
app — the same dispatch that keeps the tab strip from loading the editor. The docs are already in
the bundle (`src/docs/pages.ts` globs `apps/k7/docs/` at build time), so the host needs no server
of its own, no build of its own and no copy of the pages that could drift from the ones `help`
shows.

The page mounts no `AuthGate`, no router and no engine gate. **Back** goes to the app's origin,
`serviceUrl(origin, "k7")`, which reads `docs.` as `app.`.

## The command reference holds only the view commands here

`HelpPage` builds its command reference from `api.commands()`, a file-service route, and the docs
host opens no workspace, so there is no file service to answer it. The fetch is already
best-effort, so the section lists the shell's own `ui` commands and nothing from `commands.yaml`.
Shipping the full reference statically would mean bundling `commands.yaml` into the frontend, for
the one host that needs it.
