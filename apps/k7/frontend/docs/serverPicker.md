# The server picker

On the tray, once the account is paired with a server, the home sidebar shows a picker above the
engine selector (`components/SidebarServer.tsx`): **This computer** or the paired server. It decides
which server the **Libraries**, **Media** and **Rehearsal** pages read. The engine is not part of
it: the selector below stays where it is, so a song from the server's médiathèque can play on this
computer's engine.

How the tray's backend reaches the server is `apps/k7/backend/docs/serverPicker.md`.

## Choices

- **On the tray only.** A server's own page has no other server to offer, and cannot reach a
  machine's backend, which answers loopback alone (`apps/k7/backend/docs/standalone.md`). A phone has
  no picker either: it reads its own library, and opens each of the server's songs on demand through
  the same forward (`packages/ui-library/docs/songSource.md`).
- **Kept per browser** (`serverChoice.ts`, in `localStorage`). It is how this machine is used, not
  a fact about the account. With no paired server it falls back to This computer.
- **One switch, two bases.** Each UI package takes `apiBase`, which follows the choice, and
  `hostBase`, which stays this backend: the engine registry, the slskd settings and the copies placed
  against the server are this machine's whatever is browsed.
- **Songs are found on the chosen server.** The hunt files what it finds into a library, so it runs
  on the server whose library the page shows: the add-song popin's download calls `apiBase`.
  Where that server is unreachable or has no slskd set up, the page says so; it offers the settings
  only when that server is this machine, since the server's are its admins', on its own page.
- **The pages remount on a switch** (`HomeRoutes` is keyed by the choice): nothing read from one
  server is shown as the other's. No page is loaded.
- **Libraries follow too**, through the server's file hub. Editing the origin's list of libraries
  needs an admin, which a paired machine cannot prove; on the server the list is read-only here.
