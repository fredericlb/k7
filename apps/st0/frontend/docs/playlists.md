# Playlists — the one screen holding both catalogues

The format, and why a playlist lives in the repository rather than on the hosted volume, are in
[`packages/song/docs/playlists.md`](../../../../packages/song/docs/playlists.md). This page is the
screen.

```
                                        ┌─ panel, on the RIGHT ─┐
cog ▸ Playlists   (or the set's button) │ ▾ été 2026      + ⤢ ✕ │  ← searchable
                                        ├───────────────────────┤     dropdown
                                        │ the songs,            │
                                        │ resolved and playable │
                                        └───────────────────────┘
        ⤢ ──────────────────────────────▸ the PAGE: YAML text | the songs
```

## A panel anchored right, not a page

A set list is opened **while** you are working, and a full-screen page forces you to leave the song
to look at it. So it is a panel **stuck to the right**, in the same row as the panes: it pushes them
rather than covering them, and it can be left open.

The playlist is chosen in a **searchable dropdown** — the `TreePicker`, the module picker's. Same
reason as everywhere else: the list is as long as the repository is old, and typing three letters is
this shell's gesture throughout. The search scores the title AND the path, because a set list is
looked for by either (`live/repet`).

The songs are **below**, resolved against the médiathèque and playable — that is `PlaylistPane`.

## The text stays, one click away

The panel is 24rem: there is no room for the YAML beside the songs. So the full-screen page is one
notch further out, and the ⤢ button opens it on the current playlist.

Every line carries its three buttons — ↑, ↓, × — because reordering is what this screen is ABOUT,
usually shortly before a gig, and having to open the YAML to remove a line is the wrong shape for
it. The page stays what it is: the whole file, its comments, its title.

Those buttons are not writes: they go up to `PlaylistEditor` exactly as the search does, and it is
the BUFFER that changes. A panel writing the file while the text half holds an unsaved version of it
would make two truths of one document. The verbs `playlist song remove` and `playlist song move` do
write the file: they serve the CLI and the command bar, where no buffer is open
(`packages/commands/docs/playlist.md`).

A shape the text cannot reorder — an inline `items: [a, b]` — disables the three buttons with the
reason in a tooltip, rather than reformatting somebody's file.

It is the same component on both sides. `PlaylistEditor` takes a `panel` prop, which removes its
header and the YAML half; below that everything is identical — same load, same buffer, same
autosave, same resolved list. Two components would be two documents to keep in step.

## Its own panel, not a settings tab, not a pane

This shell's panes are the **open song** — editor, timeline, graph, viewport — and what they draw is
what the project DECLARES (`docs/shell.md`, `packages/song/docs/surfaces.md`). A playlist is
declared by no project and belongs to none: it is at the root of the repository and it is the same
whichever song you are working on. So it is not a pane, even now that it has a column — and it is
not in the URL either.

Nor is it a **settings tab**, though the cog is what opens it: that would file it by where you
arrive from. Settings are what you set and leave; a set list is what you work FROM. So it shares the
right-hand column with settings and sharing (`rightPanel` in `App`, `docs/shell.md`) without being
filed inside them.

Like everything else in this shell, what opens it **dispatches a command line** — `ui playlists`,
which toggles the panel — rather than calling a function of its own: everything on this screen is
reachable from the palette, and a single implementation is what stops the two diverging
(`docs/shell.md`).

## A button in the bar, on a SET only

A project declaring a `turntables` surface carries a **Playlists** button in the bar, beside Share
and Settings. On a desk the playlist IS the set list: it is the screen you open mid-set, and hunting
for it in the palette is the wrong shape for the one thing you look for during the evening.

On a song there is no button — the bar is only so wide, and set lists are not what you came for.
`ui playlists` still opens them: same line, so one behaviour and one journal entry. Never on a
shared snapshot — a share has no repository, so no `_playlists/`.

## Three servers

This is st0's screen that talks to **pl8** for something other than the session. The table
`AGENTS.md` holds therefore becomes:

| | for what | where |
|---|---|---|
| st0 backend | the session, the engine registry | same origin, **at the root** |
| file service | the playlist itself — `/playlists`, `/file`, `PUT /file` | engine's machine, cross-origin |
| **pl8 médiathèque** | the songs the playlist names | same origin, under `/pl8` |

That last one is the trap, and worth writing down: **st0** answers the origin root, so its `BASE` is
the empty string and a bare `/api/mediatek/*` goes to its own backend, which has no such route.
Calls to the médiathèque go through `serviceUrl(…, "pl8")`, never through `BASE` and never
hard-coded: written bare they come back 404 and the empty catalogue reads as "you have no songs".

A hard-coded prefix would be right until the target service moves and wrong without changing shape
the day it does: asking the table is what cannot be wrong. `/auth/*` at the top of `api.ts` is the
case that does not move — it stays bare, because the IdP knows only a `redirect_uri` with no prefix,
so the prefix-less service is the one that serves it.

Authentication is the session cookie, which is also what makes `songUrl` work in an `<audio src>`: a
media element cannot set a header, and does not have to when the bytes are same-origin.

## One new route

`GET /playlists` lists; **reading and writing a file are `/file` and `PUT /file`**, which already
serve any path in the workspace. A second pair spelling `_playlists` into its URLs would be two ways
to write one file — and the autosave this screen runs on is built on the one that exists.

The listing is a separate route for the reason `/module-libraries` is: `/tree` is rooted on the
active project, deliberately, so the folder is invisible to it.

There is **no** `POST /playlists` either, by the same reasoning one notch further: creating a
playlist is a **command**, so the write goes through `/command` with everything else. Its rules —
the template rather than an empty file, the extension added, an existing playlist refused — are the
verb's, with its tests.

## Creating and adding are verbs

| what you do | the command |
|---|---|
| "New playlist" | `playlist new <nom>` — subfolders included (`live/repet`) |
| add a song, by name | `playlist song add <playlist> <morceau> [variante]` |

Both act on the **repository** (`repoDir`) and not on the project: they are the only verbs in the
catalogue that work with no project open, which is exactly what a playlist is. The song is **all the
rest of the line**, spaces included, because a reference is a path through the médiathèque's folders
(`AC-DC/Back in Black/Hells Bells`); **in quotes**, a variant may follow it. One rule, and the only
one distinguishing "a song with spaces" from "a song and a version".

**Adding by search, in the right-hand pane, does not dispatch the second**, deliberately: a click
writes into the **open buffer** beside it, for the reason above. The two paths share the one thing
that must be shared, `appendPlaylistItem` — the same relation `event trim`'s gate preset has with
`trimWindow` (`docs/shell.md`): one implementation, two callers, at two different levels.

So the verb is what you use **from the palette, a key or the CLI**, when the screen is not open —
and that is where it earns its keep: building a setlist without leaving the timeline.

## The right-hand pane follows keystrokes, not saves

`items` is recomputed on every keystroke, but is **only replaced by something readable**: half-typed
YAML fails to parse about every other keystroke — a bracket not yet closed — and a panel that
emptied each time would flicker for the whole length of the line being written. The footer says when
what is shown is behind the text.

There is no Save button: the file is written as soon as the buffer **reads as a playlist**. A
half-typed line elsewhere in the file therefore holds the addition back too — that is the point, the
file is written whole or not at all. See
[autosave.md](../../../../packages/ui-editor/docs/autosave.md).

## Where the two catalogues meet

`parsePlaylist` keeps its references verbatim, because resolving them needs the list of songs. This
screen is the only one in the app holding both, and therefore the only one where "that song does not
exist" is a question that can be answered.

The resolution itself is pure and tested separately (`playlistItems.ts`): path first, name second. So
a line can be written `AC-DC/Back in Black/Hells Bells` — what a click writes — or just
`Hells Bells` — what someone types.

A line resolving to nothing **stays on screen**, and that is the point: the file is edited by hand,
just to the left. A line that vanished silently would be a typo you cannot see. A row saying "not
found" is a typo you fix.

| what is said | what to do |
|---|---|
| `morceau introuvable` | the reference names no song — fix the line |
| `variante « x » introuvable` | the song is there, that version is not |
| `ce morceau n'a pas de master` | catalogued folder with no audio — the scan allows it |
| `introuvable` (on the row) | the sidecar declares a file the folder does not have |

## Two buttons and a link

**"Chercher un morceau"** opens a field above the list — above and not over it: what you are filling
stays visible, and watching it grow is the only confirmation there is. The search covers title,
artist and path (so the album), and **every word must land somewhere, not in the same place**:
"nirvana lithium" finds a song where one is the artist and the other the title. Enter takes the
first result, Escape closes. The field **stays open** after a click: building a setlist means adding
eight songs in a row.

A row adds the **master**; the pills beside it add a **variant** — without them, putting
`instrumental` in a setlist would mean hand-editing the mapping, when the format exists precisely to
carry it.

### "Ajouter de nouveaux morceaux" — a link, not a button

At the **foot of the list**, and it leads to pl8. This screen *names* songs; the volume that holds
them is elsewhere, and the screen where one is deposited is the médiathèque's, with its three-field
dialog. That is where a library is *filed*: tags are asked for rather than guessed, and a song
already present is recognised instead of being reported as a 409 to someone who only wanted a
setlist. One place a song arrives, so no second deduction of the folder to become a second spelling
of the same song. The price is leaving the screen; the song list is repolled every few seconds
anyway, so on return the deposited song is searchable here with nothing reloaded.

**The foot of the list, not the top bar**: the bar carries what you do *to this playlist*, and
leaving for pl8 is not that. At the bottom, it is the natural continuation of a list you have just
scanned without finding what you wanted.

### "Séparer les stems" — preparing the whole set list

The second button, and the only one that costs hours. Each song is split into drums / bass / other /
vocals, so that one can be **removed** on the desk during the set
([ui-turntables/docs/stems.md](../../../../packages/ui-turntables/docs/stems.md)).

It is here and not on the desk because it is a question of **set list** and not of record: the desk
catches up with the song you have just dropped, this screen prepares the twelve you are going to
drop.

The button opens a bar above the list — same place as the search, and for the same reason: what it
works on stays visible below.

- **The chain is not asked for here.** It is DISPLAYED — the bar shows the one that will run and no
  more. Which module separates and which model it wants is a single answer for the machine: given
  once in settings, under I/O, living in `<state>/preferences.yaml` (`system stems`). A picker here
  would ask the same person the same question on every set list, and three screens that ask it are
  three places to get it wrong. The preference is re-read every time the bar opens, because settings
  are one click away.
- **One song at a time.** Two separations in parallel on one machine are two hours of arithmetic
  fighting over the same cores and finishing no sooner — the rule `runColdPasses` already states for
  the command.
- **The bar counts two things.** Songs finished PLUS the progress of the one in flight: a bar
  counting only songs would sit still for four minutes at a time, and one showing only the job's
  percentage would return to zero twelve times.
- **Relaunching costs nothing.** An already-separated song is skipped — the route asks the FOLDER,
  not a flag — and the job id hashes the WORK, so an interrupted pass rejoins the computation in
  flight instead of starting a second one.
- **Closing the panel stops the loop, not the computation.** A separation is a job on the machine
  and runs to the end; what the Stop button interrupts is the chaining of the songs after it.

#### What is already separated shows on the row

A row whose song carries stems shows the **separation icon** on the right, beside the artist. What it
reads is the catalogue's `meta.stems` — a `stems/` folder seen by the scan
(`packages/mediatek/src/scan.ts`), so not one more call per line: the song list is already there and
already repolled.

It is a **snapshot and not a truth**, the same caveat the desk writes for itself
(`packages/ui-turntables/src/views/MixView.tsx`): what actually decides is the route, which asks the
folder at the moment of separating. So the icon answers "which are left to prepare?" before
launching, and nothing the loop does depends on it — it would skip those lines anyway, and counts
them separately under "already separated".

It appears at the **poll following** the end of a separation, not the second the job returns: the
catalogue is re-read on a timer, and a per-line invalidation would be a write path for an icon.

Two kinds of failure, told apart by HTTP status and treated differently:

| what fails | status | what the loop does |
|---|---|---|
| the song — this machine has not pulled it | 404 | one red line, and on to the next |
| the run — no chain set, the chain does not separate, no model, no project open | 400 / 409 | everything stops |

The second is the same answer for all twelve lines: continuing would be twelve identical refusals
and no work done. The **Lancer** button is dark while no chain is set, with the sentence saying where
to go and a shortcut into settings — finding that out at the first song would be finding it out too
late.

**This button does not dispatch `playlist stems`**, and it is the same exception as adding by search,
with a reason of its own. The verb exists and does the same work — it is what you use from the
palette or the CLI. But a command returns its lines **when it has finished**, and finishing, for
thirty songs, is an hour of blank screen. So the button does one `POST /pl8/api/stems` per line and
polls the job in between, which is the only shape that has a bar. On **pl8**: it holds the masters,
so it leads the split and keeps the stems, borrowing the engine's model (`apps/pl8/docs/stems.md`).
What the rule demands stays true: the ACT is reachable from the command bar.

## The transport is ours, and it is tiny

One `<audio>`, one line at a time, on a same-origin URL.

It **starts on a row** and nowhere else: there is no "Play all" in the bar, because reading a setlist
from the top is what the desk does, with the engine behind it. What you listen to here is the line
you have just added — and the next one follows on, which gives "from here" without a button having
to say so.

pl8 has a shared `PlaybackProvider` — a mini player outliving the screen, with a browser/engine
destination behind it. None of that here, deliberately: that machinery exists because pl8 is a
**listening** application whose bottom bar follows you from section to section, whereas this shell is
an editor that already has a transport of its own, driving the engine on a project. Two things
claiming the word "playing" on one screen are two transports.

An unplayable line is **skipped**, not blocking: a playlist that stopped at its third line over a
typo would be a playlist you cannot listen to while you fix it. The row says what is wrong; it does
not stop the evening.

## What a playlist is for, once written

It is not only a list to re-read: it is a **surface's parameter**. A `turntables` surface — the DJ
desk — carries a `playlist:` line, and that is the playlist its song browser lists:

```yaml
# <projet>.st0/surfaces/desk.yaml
type: turntables
layout: split
playlist: ete-2026
```

Two consequences, and the second is the one that matters:

- the desk searches the evening's twelve songs rather than the volume's 279;
- the machine that plays **pulls those songs onto its disk in advance** (`mediatekPull`), because
  the engine opens file paths and the venue has no wifi.

That is also what gives this screen its stakes: the playlist filled in here is the one that gets
played. See `packages/ui-turntables/docs/setList.md`.

A line naming a **variant** holds on both screens: the desk loads the file the line asks for, not the
master. It is the same resolution on both sides — literally the same function,
`@studio/mediatek/playlistItems` — because "path first, name second" is a rule, and two copies would
diverge at the first case learned on one side only.

## What pl8 cannot do from its side

pl8 has set lists of its own, under `playlists/` on its volume (`apps/pl8/docs/playlists.md`), in
this same format. What it cannot do is write into **this** one: the workspace's `_playlists/` is on
the file service's disk, and giving pl8 the means to write there would make the service that holds
the session and the single deploy key a writer into everyone's repository, which
`apps/pl8/docs/projects.md` explicitly refuses.

Its hunt therefore targets no playlist at all — it files the song into the médiathèque, and adding
it to a setlist is one click, here or on its own tab, on exactly that catalogue.

The one that matters for a gig is **this** one: a `turntables` surface resolves `playlist:` in the
workspace, so the desk's browser and the pre-fetch read `_playlists/` and never the volume's folder.
