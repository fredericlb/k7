# The address is what you are looking at

The médiathèque is one screen with a section chosen in the host's nav and, sometimes, a song's
editor over the top of it. Both live in the address rather than in component state: held in state the URL would say
`/mediatek` whatever you were doing — no bookmark, no link to a song, no Back out of the
editor, and a reload dropping you at Songs.

The address carries both, and reads exactly like the path on disk. The host mounts the screens
under a prefix — `/media` in k7 — and hands it over as `prefix` ([host.md](host.md)), so below
that prefix:

```
/songs                                    the section
/songs/Miles/Kind of Blue/So What/song.yaml  …and the song the editor has open
```

The first segment is the section, which is also the family folder's name — so the rest is
the path **inside** that folder, once, rather than the section repeated. `routes.ts` is the
whole mapping and knows nothing about how deep a song sits: it splits the head off and
hands the rest along, which is why an album folder needs no change here.

## Why `editingSong` is derived and not held

It is a `useMemo` over `(entries, file)`. Held as state, a route that merely *set* it would
arrive before the listing does — the address names a file, and the entry it belongs to comes
from `/list`, one round trip later — so opening one would have to be replayed once the entries
landed.

Nothing to replay this way: it resolves the moment the listing arrives, and `null` covers
both "nothing open" and "not loaded yet", which is the same thing to draw — the catalogue
shows through until then.

## The loop, and the two nulls

`useLibraryRoute` is k7' `useViewRoute` with a different state, deliberately: the hazard
is identical. Two passive effects, one writing the URL from the state and one the state from
the URL, will ping-pong unless each can say "nothing to do here".

- **The screen did not change.** The effect just re-ran.
- **The URL already says so.** We got here BY the address — a deep link, or Back. In that
  commit the state→URL side is handed the OLD state and the NEW location, which looks exactly
  like the app having moved away from the address. It has not, and the only honest test is
  whether the address already agrees with where we are going.

Both decisions are pure functions (`urlForState`, `stateForLocation`) and `routes.test.ts`
runs them as a **sequence** — a move writes the URL, and reading that URL back has nothing to
do. A single-step test cannot catch a loop.

## Push and replace

Opening a file **pushes**, so Back closes the builder rather than leaving the app. Everything
else replaces: a section you clicked through is not a place you want to walk back out of one step
at a time.

## Serving it, and the prefix

Deep links need the server to hand `index.html` to a path that is not a file: k7's backend does it
for every path but `/api`, `/auth` and `/assets/` (`apps/k7/backend/src/server.ts`), and vite's dev
server does by default. The alias host, `play.`, sends every page to the same path under
`/media` with a 301, so an address saved there still lands on its section
(`packages/web-protocol/docs/addresses.md`).

The router is the HOST's, with its own basename; this package does not own one. `routes.ts` takes
the prefix as an argument in both directions — `toPath(state, prefix)` and
`fromLocation(pathname, prefix)` — and a path that is not under it reads as the default section.
The host, for its part, must reserve the prefix as a whole: k7 does it in
`packages/web-protocol/projects.ts` (`MEDIA_PAGE`, a reserved PREFIX), since a first segment is
otherwise read as a workspace's name.

## Every section is an entry of the host's nav

The five sections — the two families, the two root zones and `find` — are drawn by the host, from
`LIBRARY_SECTIONS` (`src/sections.ts`); in k7 they are entries of the home sidebar. Settings are
not a section: their two cards are sections of the host's own settings page
([settings.md](settings.md)).

`find` draws edge to edge, because nothing it shows is on the volume, and it is a section rather
than a dialogue for the reason the rest of this page argues: **an address**. A page reloads,
bookmarks, and answers the back button; a modal does none of the three, and the hunt grows a
history a dialogue would make scroll inside a scroll — see [hunt.md](hunt.md).

The cost is a subtraction to keep up to date. `useLibraryData.ts` derives `FamilyId` by removing the
non-family ids from `SECTION_IDS`, so a section added there and forgotten here silently becomes
a family the poll asks the server to list.

## The whitelist of sections that carry a path

`fromLocation` drops the second half under a section that cannot open anything: the URL bar is
user-editable, and `/media/samples/kicks/909.wav` names nothing these screens can show. The whitelist is
`CARRIES`:

```
songs      …/song.yaml      the song, opened on the split screen
playlists  ete-2026.yaml    the set list, opened in the right-hand pane
```

**Two rows, and it stays a list rather than a test**, because what each carries is not the same
shape. A `songs` address names a file INSIDE an entry's folder, which is what lets `folderOf`
take the last segment off and find the entry. A `playlists` address names the file and nothing
else — the zone nests, so `live/repet.yaml` has a folder, but `ete-2026.yaml` has none and
`folderOf` answers null for it.

That asymmetry is the reason `editingSong` is derived from `entries` **and** the section, rather
than from `folderOf(file)` alone: a set list's address resolves to no entry, and must not be
looked for among them.

An address under a section that is not in `SECTION_IDS` is not a 404 inside the app:
`fromLocation` drops what it cannot read and lands on the default section, so a stale bookmark
to `/media/modules/x/ui.k7x` opens the songs rather than nothing.

A section that opens something must be in `CARRIES`, and the failure if it is not is quiet:
the editor pushes `/<section>/x/graph.k7x`, `fromLocation` reads that back as the bare
section, and the URL→state effect applies `file: null` and shuts the editor a tick after it
opened.

That is the loop `useLibraryRoute` exists to prevent, arriving through the one door its two
guards cannot watch — **an address the app writes and cannot read**. Both guards compare a
state to a location, so both agree, correctly, that there is nothing to do; the disagreement is
between `toPath` and `fromLocation`, one function earlier. Hence the round-trip case in
`routes.test.ts`, which walks every screen through `fromLocation(toPath(s))`: a section that
opens something and is missing from `CARRIES` fails there, at the point where the two
directions stop being inverses.

k7's router sits **outside** its auth gate, so a deep link survives signing in.

## Percent-encoding, per segment

Songs are the reason. A song folder is `segment()`'d from tags and legitimately holds spaces,
`&` and parentheses — "Back in Black". The browser encodes those on their way into the URL bar,
so `location.pathname` comes back `Back%20in%20Black`, which matches no entry. Encode on the way
out, decode on the way in, and the two directions stay inverses — which is the whole contract
`routes.test.ts` asserts.

Per SEGMENT and not over the whole string: `encodeURI` leaves `#` and `?` alone, and a title
carrying either would cut the address in half. A hand-typed `%zz` throws rather than decoding; the
raw segment is the best remaining guess, and it simply matches no entry, which is what a typo
should do.

## The default section is the songs

What the library holds is the catalogue, and the catalogue's first family is the songs. The bare
prefix opens it. The front door for one's own work is k7's home page, the origin root.

## What is not here, and the backend that is

- **`modules` and `chains`** belong with the AUTHORING: a module is written against a project
  where the plugin it names is actually LOADED, and written into a library folder by an
  admin, from any project open in the editor. That is the editor's job, not a catalogue's.
- **The level above a project** — the workspaces, the libraries and the
  shares — belongs to the editor that opens one, so it is the other pages of k7's home.

**Playlists**, on the other hand, ARE here — `playlists/` on the volume, its own section, beside
the songs a line names ([playlists.md](playlists.md)). A workspace keeps its own under
`_playlists/`, same format and a different job: those are versioned with the project and are what
a `turntables` surface can name.

The shares and the whole of `/api/mediatek` are the same backend's routes, and k7's other pages
call them on the same origin; the workspaces, the libraries and the key are the file service's ([projects.md](../../../apps/k7/backend/docs/media/projects.md)). An address under the
media prefix naming any of those falls through to the default section like any other unknown path. See
[apps/k7/frontend/docs/projects.md](../../../apps/k7/frontend/docs/projects.md) and
[apps/k7/frontend/docs/playlists.md](../../../apps/k7/frontend/docs/playlists.md).
