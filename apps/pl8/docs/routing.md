# The address is what you are looking at

The médiathèque is one screen with a section tab and, sometimes, a module builder over the
top of it. Both were component state, so the URL said `/mediatek` whatever you were doing:
no bookmark, no link to a module, no Back out of the builder, and a reload dropped you at
Songs.

The address now carries both, and reads exactly like the path on disk. pl8 serves the
studio ORIGIN — it has no prefix of its own — so these are the whole address:

```
/songs                                    the section
/songs/Miles/Kind of Blue/So What/song.yaml  …and the sidecar the editor has open
```

The first segment is the section, which is also the family folder's name — so the rest is
the path **inside** that folder, once, rather than the section repeated. `routes.ts` is the
whole mapping and knows nothing about how deep a song sits: it splits the head off and
hands the rest along, which is why an album folder needs no change here.

> The examples were `/modules/…` for a year, and the section carrying the deepest paths was
> `modules`. Both it and `chains` left the catalogue — a module is authored in st0 — so the
> address space is three families now.

## Why `editing` is derived and not held

The builder used to be `useState<{entry, pane}>`. If the route merely *set* that, a deep
link would arrive before the listing does — the address names a file, and the entry it
belongs to comes from `/list`, one round trip later — so opening one would have to be
replayed once the entries landed.

So it is a `useMemo` over `(entries, file)` instead. Nothing to replay: it resolves the
moment the listing arrives, and `null` covers both "nothing open" and "not loaded yet",
which is the same thing to draw — the catalogue shows through until then.

## The loop, and the two nulls

`useLibraryRoute` is st0' `useViewRoute` with a different state, deliberately: the hazard
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
else replaces: a tab you clicked through is not a place you want to walk back out of one step
at a time.

## Serving it

Deep links need the server to hand `index.html` to a path that is not a file. `nginx.conf`
already did (`try_files $uri /index.html`), and vite's dev server does by default.

`basename` comes from `import.meta.env.BASE_URL`, and that one line is what made moving this
app a one-line change: it read `/` while pl8 answered the origin root and reads `/pl8/` now
that st0 does. `routes.ts` is still written as if the app owned the origin, because react-router
strips the basename off everything it hands back — so nothing below it had to be touched.

**A section id no longer has to dodge the origin's other services.** It did while this app was
the catch-all: `/st0`, `/k7`, `/z0` and `/dev` belong to other services, and a section named
after one of them would have been unreachable, the edge never handing the request here. Under
`/pl8` nothing on the origin can reach these ids at all. The constraint MOVED rather than
vanished — it is st0 that addresses a project as `/<dépôt>/<projet>` now, so it is a REPOSITORY
name that can collide with `/pl8`, `/k7`, `/z0`, `/api` or `/auth`. `routes.test.ts` keeps
asserting the old property, which costs nothing and documents what the ids used to have to be.

> **`projects` was a seventh section here**, and the one case where the second half of an
> address was not a file but a repository id. It is st0's home page now
> (`apps/st0/frontend/docs/projects.md`), so `/projects` is an unknown first segment like any
> other typo and falls back to the default — which is worth knowing when an old bookmark lands
> on Morceaux instead of on a blank screen. The routes it called are still this service's; only
> the screen moved.

## Two sections have no tab

`engine` and `find` are in `SECTION_IDS` but not in the header's tab strip. Each is reached by a
button on the section it belongs to — the cog for the engine page, « Trouver des morceaux » on
Morceaux — and each draws edge to edge, because nothing either shows is on the volume.

They are sections rather than dialogues for the same reason: **an address**. A page reloads,
bookmarks, and answers the back button; a modal does none of the three, and both of these hold
enough content to be worth returning to. `find` in particular grows a history that a dialogue
would have made scroll inside a scroll — see [hunt.md](hunt.md).

The cost is a subtraction to keep up to date. `Library.tsx` derives `FamilyId` by removing the
non-family ids from `SECTION_IDS`, so a section added here and forgotten there silently becomes
a family the poll asks the server to list.

## The whitelist is a list, and it was short by one

`fromLocation` drops the second half under a section that cannot open anything: the URL bar is
user-editable, and `/samples/kicks/909.wav` names nothing this app can show. That whitelist was
two `head === …` tests, and it is now `CARRIES`:

```
songs      …/song.yaml      the sidecar, on the left of the split screen
modules    …/ui.yaml        one of the builder's three panes
chains     …/graph.yaml    the template, beside the graph it draws
playlists  live/ete.yaml    the file ITSELF — there is no folder in front of it
projects   3f9a1c2b7e40     a repository id, not a path
```

**`songs` is the only one left**, and the list stays a list because of how it got there: four
of those five rows are gone, one per feature that moved to st0. `playlists` was the last, and it
was also the odd one — every other row names a file INSIDE an entry's folder, so `folderOf`
takes the last segment off to find the entry, while a playlist HAD no folder. That asymmetry
went with it (`packages/song/docs/playlists.md`), which is why `folderOf` now always has
something to take off the end.

An address under a departed section is not a 404 inside the app: `fromLocation` drops what it
cannot read and lands on the default section, so an old bookmark to `/playlists/ete-2026.yaml`
opens Morceaux rather than nothing.

`chains` had to be added, not merely `songs`, and it is worth saying why: the chain editor
already pushed `/chains/x/graph.yaml`, and `fromLocation` read that back as the bare section.
The URL→state effect then applied `file: null` and shut the editor a tick after it opened.

That is the loop `useLibraryRoute` exists to prevent, arriving through the one door its two
guards cannot watch — **an address the app writes and cannot read**. Both guards compare a
state to a location, so both agree, correctly, that there is nothing to do; the disagreement is
between `toPath` and `fromLocation`, one function earlier. Hence the round-trip case in
`routes.test.ts`, which walks every screen through `fromLocation(toPath(s))`: a section that
opens something and is missing from `CARRIES` fails there, at the point where the two
directions stop being inverses.

The router sits **outside** the auth gate in `main.tsx`, so a deep link survives signing in.

## Percent-encoding, per segment

Songs are the reason. A module was a slug and survived a raw path, but a song folder is
`segment()`'d from tags and legitimately holds spaces, `&` and parentheses — "Back in Black". The
browser encodes those on their way into the URL bar, so `location.pathname` comes back
`Back%20in%20Black`, which matches no entry. Encode on the way out, decode on the way in, and the
two directions stay inverses — which is the whole contract `routes.test.ts` asserts.

Per SEGMENT and not over the whole string: `encodeURI` leaves `#` and `?` alone, and a title
carrying either would cut the address in half. A hand-typed `%zz` throws rather than decoding; the
raw segment is the best remaining guess, and it simply matches no entry, which is what a typo
should do.

## What the default section is, and why it moved back

Morceaux again. It was Projets for as long as this app held the repositories — the argument being
that the first thing you want at a front door is your own work — and that argument did not lose, it
MOVED: the repositories are st0's home page now, so the front door for one's own work is over
there. What is left here is the catalogue, and its first family is the songs.

## The four sections that left, and the one backend that did not

- **`modules` and `chains`** went with the AUTHORING: a module is written against a project where
  the plugin it names is actually LOADED, and committed to the account's library repository.
- **`projects`** went with the level above a project, which belongs to the editor that opens one —
  the repositories, the libraries, the deploy key and the shares. It was this app's default section
  at the time.
- **`playlists`** left last and for a different reason: not authoring, but that a playlist holds no
  bytes. It is a list of names of things that are still right here, so hosting it bought nothing
  and kept a set list out of the repository it was written for. It is `_playlists/` in the
  workspace now, and st0's cog opens it. The morceaux it names never moved, which is the point: st0
  searches THIS catalogue and uploads into it.

What did **not** move is the backend. `/api/projects`, `/api/shares` and the whole of
`/api/mediatek` are still this service's, and st0 calls them across the origin. An address under
any of the departed sections falls through to the default like any other unknown path. See
[apps/st0/frontend/docs/projects.md](../../st0/frontend/docs/projects.md) and
[apps/st0/frontend/docs/playlists.md](../../st0/frontend/docs/playlists.md).
