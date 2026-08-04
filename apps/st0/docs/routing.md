# The address is what you are looking at

The médiathèque is one screen with a section tab and, sometimes, a module builder over the
top of it. Both were component state, so the URL said `/mediatek` whatever you were doing:
no bookmark, no link to a module, no Back out of the builder, and a reload dropped you at
Songs.

The address now carries both, and reads exactly like the path on disk. st0 serves the
studio ORIGIN — it has no prefix of its own — so these are the whole address:

```
/modules                                  the section
/modules/audio/reverb/ui.yaml             …and the file the builder has open
/modules/audio/filter/auto-wah/module.yaml a module under a category
```

The first segment is the section, which is also the family folder's name — so the rest is
the path **inside** that folder, once, rather than the section repeated. `routes.ts` is the
whole mapping and knows nothing about how deep a module sits: it splits the head off and
hands the rest along, which is why a category folder needed no change here.

## Why `editing` is derived and not held

The builder used to be `useState<{entry, pane}>`. If the route merely *set* that, a deep
link would arrive before the listing does — the address names a file, and the entry it
belongs to comes from `/list`, one round trip later — so opening one would have to be
replayed once the entries landed.

So it is a `useMemo` over `(entries, file)` instead. Nothing to replay: it resolves the
moment the listing arrives, and `null` covers both "nothing open" and "not loaded yet",
which is the same thing to draw — the catalogue shows through until then.

## The loop, and the two nulls

`useLibraryRoute` is l8' `useViewRoute` with a different state, deliberately: the hazard
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

`basename` still comes from `import.meta.env.BASE_URL` even though there is no prefix left
to strip. That is deliberate and not a leftover: the vite config is the one place a prefix
would be declared, so reading it here means re-prefixing the app is a one-line change rather
than a hunt. Today it reads `/`, and `routes.ts` is written as if the app owned the origin —
which it now does, literally.

**One address is not st0's**, and Caddy claims it above the catch-all: `/l8`, `/m9`, `/k7`,
`/z0` and `/dev` belong to the other services. A section named after one of those would be
unreachable — the edge would never hand the request here. The six section ids are safe today,
and `routes.test.ts` now asserts it rather than leaving it to be remembered.

## The second half is not always a file

`projects` is the sixth section and the second one to carry something after its name, but what
it carries is a **repository id**, not a path inside a folder:

```
/projects                        the list of repositories
/projects/3f9a1c2b7e40           …and the tree of the one that is open
```

It reuses `RouteState.file` deliberately. It is the same question — *what, inside this section,
are you looking at* — and a field of its own would be null for four of the six sections while
meaning exactly what this one already means. `fromLocation` keeps the whitelist that made
`songs/some/thing.yaml` fall back to the bare section; it just has two entries now.

The router sits **outside** the auth gate in `main.tsx`, so a deep link survives signing in.
