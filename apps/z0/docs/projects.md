# z0's projects

A blindtest session is filed the way st0 files a song: **a folder of YAML**, versioned, opened on
a project. This page states its shape, derived from the three real sessions in the Grist document
`wBLP4e1P71vAW3T5zzfQtH` — the figures cited come from there.

The game loads its rounds from Grist (`backend/src/grist/`): nothing on the play side reads these
YAML. The editor is what writes them — [editor.md](editor.md).

## What the Grist sessions say

| table | rows | what it tells us |
|---|---|---|
| `Sessions` | 3 | `name`, `guestPassword`, `urlToken`, and the order as a `RefList` |
| `OrderEntries` | 49 | 45 categories played, 4 breaks |
| `Categories` | 38 | **each belongs to exactly one session** (38/38) |
| `Songs` | 279 | only 9 are shared between two categories |
| `Tracks` | 307 | 12 shared between two songs |
| attachments | 305 | **1.35 GB of MP3**, named `Artiste - Titre.mp3` |

Five observations decide the shape:

1. **Nothing is really shared between sessions.** The Grist schema is a graph of references
   because a table is a graph; the data is a tree. A session can therefore be a self-contained
   folder without losing anything.
2. **The order is a sequence of slices.** Session 1: `Stems [0:5]`, then later `[5:10]`, then
   `[10:]` — a crate of 15 songs played in three passes. The category appears three times in the
   order with a different window each time. That is a real intention ("this crate hangs
   together") and has to be kept.
3. **`trackType` is a variant, and the médiathèque already models those.** A `Stems` category
   plays the `type: stems` track and reveals the `type: ""` track of the same song — two `Tracks`
   rows with the *same* artist and title. That is exactly `variants:` in `song.yaml`
   (see [packages/mediatek/docs/variants.md](../../../packages/mediatek/docs/variants.md), whose
   example chain is already called `blindtest/vocal-strip`). The 9 songs shared between two
   categories are the same case: "Take on me" serves as `8bit` in one and `handmade` in another.
4. **`notice` is boilerplate.** 24 of 38 categories carry the exact same sentence
   (`À TROUVER: ARTISTE ET TITRE`) — it wants a default at session level. `illustration` is empty
   everywhere: optional, never written.
5. **1.35 GB does not go in a git repository.** The audio goes to the médiathèque; the YAML
   carries only the address.

## What the YAML keeps, what the database keeps

> the YAML holds **what an author writes**, the database holds **what a game produces**.

So the database — Grist or SQLite, that debate is elsewhere — keeps `Games`, `GamePlayers`,
`Scores`, `SoloProgress`, `Buzzers`, `Guests`, `Counters`, `Playlists`, `PlaylistScores`. None of
those describes a session; all of them describe a game played.

## The shape

Like a `.st0`: a folder, a header file, one file per entity, and **the file name is the
identifier**.

```
blindtest-2304.z0/
  session.yaml
  categories/
    la-chauffe.yaml
    stems.yaml
    moderne.yaml
    …
```

Keys are in **English** and prose in French: the rule the médiathèque already states for
`song.yaml` ([songs.md](../../../packages/mediatek/docs/songs.md)).

### `session.yaml`

```yaml
name: Blindtest 2304
token: blue                              # l'URL publique (ex-urlToken)
password: "…"                            # ex-guestPassword, absent = no password
notice: "À TROUVER : ARTISTE ET TITRE"   # the default for every category

order:
  - cat: la-chauffe
  - cat: stems
    songs: 1-5
  - cat: moderne
  - cat: extraits
    songs: 1-5
  - pause:
  - cat: citoyens-du-monde
  - cat: stems
    songs: 6-10
  - cat: fusion
  - cat: stems
    songs: 11-
```

`cat:` names a file in `categories/`, not the displayed name: two consecutive entries on `stems`
really are one category sliced. `songs:` is a **1-based, inclusive** range, open bounds accepted
(`11-`); absent, the category is played whole. It reads where it is corrected, which `[5:10]`
does not.

A break is `- pause:` — the value, when present, is the message shown on screen
(`- pause: Entracte`).

**The guest password is in clear**, and that is a choice: it travels with the session, a session
without it opens to nobody, and a local file beside it would be the one nobody thinks to copy. It
is a party password, not a secret — but it is in clear in a git repository, which means changing
it is a commit.

### `categories/<slug>.yaml`

The common case, one track per song:

```yaml
name: La Chauffe
songs:
  - song: songs/Michael Sembello/Flashdance/Maniac
    start: 6.43
    end: 246.29
    status: valid
  - song: songs/Daft Punk/Discovery/Harder Better Faster Stronger
```

`song:` is the médiathèque identifier, i.e. the path relative to its root — the only stable
identifier it offers (`MediatekEntry.id`). Artist and title come from the sidecar and are not
copied here.

A category with a variant, where the gain is clearest:

```yaml
name: Stems
variant: stems          # what is PLAYED; the master is what is REVEALED
songs:
  - song: songs/Zaz/Album inconnu/Je veux
    start: 24.78
    end: 212.6
    status: valid
  - song: songs/Britney Spears/Album inconnu/Toxic
    start: 14.57
    end: 196.79
```

Two `Tracks` rows per song collapse into one word: the reveal track *is* the master at the same
address. Same for `8bit` and `handmade`.

`variant:` carries **two axes on one line**, deliberately: a recorded version (`stems`, `8bit`,
`handmade` — a file beside the master) or a treatment (`deformees` — a chain the médiathèque
holds). Both answer the same question, "which version of this song do we play", and the sidecar
knows which of the two it has. A category cannot ask for both at once, and none on the volume
does.

**The resolution rule is "the version asked for if it exists, otherwise the master".** That is
not a polite fallback, it is what the Grist loader already does: a song whose category asks for
`8bit` when no track of that type exists plays as it is, with no distinct reveal audio. Thirteen
entries are in that case, all covers whose original nobody ever filed beside them — their
`original.mp3` **is** the cover.

A category with several tracks per song — `fusion` (two extracts, a pun) and `multi` (five
extracts played together):

```yaml
name: Fusion
mode: fusion
liveOnly: true
notice: "À TROUVER : JEU DE MOTS ENTRE ARTISTE OU TITRE ET SÉRIE"
songs:
  - label: The Senti-Nelly Furtado
    status: valid
    tracks:
      - song: songs/Nelly Furtado/Album inconnu/I'm like a bird
        start: 54.68
      - song: songs/Artiste inconnu/Album inconnu/The Sentinel
        start: 8.14
```

The TV theme has no artist in Grist and nobody invented one: it is filed under
`Artiste inconnu`, which is true and is fixed by a rename. Eleven tracks are in that case, all
themes from the `fusion` categories.

```yaml
name: Assourdissant
mode: multi
songs:
  - tracks:
      - song: songs/REM/Album inconnu/Losing my religion
        start: 17.1
      - song: songs/The Supermen Lovers/Album inconnu/Starlight
      - song: songs/Daft Punk/Album inconnu/Around the world
        start: 24.9
  - effects: { overdrive: 5 }
    tracks:
      - song: songs/Stardust/Album inconnu/Music sounds better with you
      - song: songs/Alizee/Album inconnu/Lolita
        start: 81.45
```

`song:` and `tracks:` are exclusive: a one-track song is written flat, a multi-track song opens a
list. That is the only shape rule to remember.

### The full vocabulary

**Session** — `name`, `token`, `password`, `notice`, `order`.

**Order entry** — `cat` + `songs` (range), or `pause` (+ message).

**Category** — `name` (displayed), `mode`, `variant`, `notice`, `illustration`, `liveOnly`,
`songs`.

`mode` is `one`, `free`, `slow`, `fusion`, `reversed`, `mystery`, `multi`, or absent for the
normal mode — the values players already read.

**Song** — `song` **or** `tracks`, plus `label`, `answer`, `status`
(`valid` | `to_replace` | absent), `liveOnly`, `speed`, `effects`.

`answer` is a **literal block** (`answer: |`) as soon as several spellings are accepted, one per
line — the form the thirty cases of session 2304 have.

A treatment is written two ways, and both coexist. Computed **at playback**, the song carries
`effects: { … }` — the map in the `multi` example above, and what `categories/deformees.yaml`
writes song by song. **Recorded**, the médiathèque holds it as a variant the sidecar names: the
category says the name once (`variant: deformees`) and each song resolves it to its own chain
with its own values. Apart: `speed`, which is not a treatment but a playback rate — no chain has
a clock. All of it is in [effects.md](effects.md).

**Track** — `song` (médiathèque address) **or** `file` (path relative to the project folder)
**or** `youtube`, plus `start`, `end`, and `artist` / `title` as a derogation when the address
does not give them.

`file:` is the way out: anything the médiathèque has not — a TV theme, a home-made extract —
stays a file in the project, with its artist and title written on the spot. Without it the 11
tracks that have not even an artist would have nowhere to go.

## What the shape does not carry

- **An order table.** The order is a ten-line list in `session.yaml`, where Grist wants one
  `OrderEntries` row per round.
- **Reveal tracks.** `variant:` says what is played; the reveal is the master at the same
  address, so there is no second track to write.
- **`artist` / `title` copied** onto each track: they come from the médiathèque sidecar.
- **Identifiers.** The file name IS the identifier, so nothing re-reads or rewrites an `id` for a
  reconciler to tell an existing entry from a new one.

## The sessions on the volume

| | |
|---|---|
| `session-2304.z0` | 15 categories, 24 rounds, guest password `blue` |
| `session-beta-2.z0` | 19 categories, 20 rounds |
| `offboarding-bedrock.z0` | 4 categories, 4 rounds |
| médiathèque | **279 songs**, **26 variants** (`stems`, `8bit`, `handmade`) |

Their audio is filed by `addSong` / `addSongVariant` from `@studio/mediatek` — the code the media library
calls itself — so the folder shape and the sidecar are exactly the médiathèque's.
`songs/A-Ha/Album inconnu/Take on me/` holds `original.mp3`, `8bit.mp3` and `handmade.mp3` under
one `song.yaml`, which is the demonstration that the model holds.

The check that counts: the 38 category files re-read, every `cat:` in every order finds its file,
every `songs:` range matches its slice, and **each of the 304 addresses cited exists on the
volume with a master**.

### The two warts, in order of urgency

1. **`Album inconnu` everywhere.** The MP3s are re-encoded rips carrying no ID3 tag — no album to
   take, and Grist has none either. The médiathèque files everything under its own hole label,
   which is made for that and can be renamed. Two songs carry `Album inconnu (2)` because two
   different recordings claim the same artist and title: "Larusso — Tu m'oublieras" (a rip and a
   video) and "OST — Star Trek" (the theme and a mouth version).
2. **Thirteen `original.mp3` that are covers**, described above. Put the real original beside it
   and the cover becomes a variant again — one operation per song, touching no YAML.

`HAS_SCAFFOLD.z0` is `false`: a `.z0` opens and lists from st0's home page; it is not CREATED
from "Nouveau projet".
