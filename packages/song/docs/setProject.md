# A SET — an st0 project with decks instead of an arrangement

An `.st0` folder like any other, read by the same loader out of the same `@studio/song`. Not a
dialect: the node project you already know, with one entity fewer and two files more.

> **The archetype that writes one is called `mix`.** That pair of names is deliberate and is the
> only place it exists: `mix` is what you ASK for in pl8's "Nouveau projet", named like its two
> neighbours `arrangement` and `video` after the surface it opens on; a *set* is what lands on
> disk, and this page is about the folder. One word cannot be right for both audiences.
> `scaffoldSet` writes it; `PROJECT_SHAPES` lists it.

| file | what it holds |
|---|---|
| `project.yaml` | the set's settings, and nothing about shape — there is no arrangement because none is declared |
| `mix.yaml` | this set's CUE points, song by song — see [mixFile.md](mixFile.md) |
| `graph.yaml` | the routing segments, exactly as in a song |
| `nodes/<name>.yaml` | its USES of the médiathèque's modules — one line each — and the DECKS, which are lanes and so nodes too ([trackModules.md](trackModules.md)) |
| `surfaces/desk.yaml` | that it draws a desk, and what each control drives — see [surfaces.md](surfaces.md) |

## Two files are what make it a set

A `turntables` surface, and the **playlist** it names. Neither needs a folder suffix to be found
and neither needs an app of its own: st0 draws the desk from its declaration exactly as it draws
a timeline or a viewport from theirs.

```yaml
# surfaces/desk.yaml
type: turntables
layout: split
playlist: ete-2026        # → <espace>/_playlists/ete-2026.yaml
stems: true               # separate a record put on unprepared (the CHAIN is the machine's)
```

`split` is a PANE: the desk sits over the chains, half the column each, and a set — declaring no
timeline — is those two and nothing else. That pairing is why it is a pane rather than a screen
of its own: a fader on the desk is a param on a module in the graph.

**The songs are not in the project.** A playlist lives at the root of the REPOSITORY, beside
`_modules`, so one set list serves every project in the workspace and is committed with the
work it was written for ([playlists.md](playlists.md)). Nothing inside the project restates it:
two files answering one question is one too many, and the playlist is the better of the two — it
has a screen and it is shareable. The CUE sheet is a separate document, `mix.yaml`
([mixFile.md](mixFile.md)).

The surface carries its own `mapping:` ([surfaces.md](surfaces.md)), so the declaration and the
wiring are one file. The desk itself is `@studio/ui-turntables`, and st0 has an engine before it
has a surface — which is the whole of what a host owes it.

No `clips/`, no `sequences/`, no `curves/`: a set holds no material of its own. What it
plays lives in the médiathèque, and what it says about playing it is the graph.

**And no `modules/` either.** A set uses modules; it does not own any. pl8 holds the only
editable catalogue, so a crossfade copied into the project would be a second crossfade
nobody maintains and nobody would notice drifting from the one everybody else uses. An
node is the whole use:

```yaml
# nodes/crossfade.yaml
extends: "@st0/audio/utility/crossfade"
params:
  Mix: 0.5
```

`kind`, `inputs` and `category` are inherited by NOT being stated — the two audio ports, the
second one optional, come from what it extends. That is the mechanism, not a shortcut; see
[nodes.md](nodes.md). A use of a module you do not own needs no local folder for it.

## `type:` earns its place, and does not win

Two things can say what a project is, and it matters which one is believed.

The folder's **suffix** decides. `@studio/web-protocol/projects` already answers "which app
opens this" from the name alone, and pl8 asks that question of a **bare blobless git
mirror** — every path, no file bodies — so any rule that had to open a file could not run
where the question is actually asked. Making the file authoritative would put the app that
opened a folder at odds with the loader reading it.

So what is `type:` for? The case the suffix cannot cover: **a repository can BE the
project** (`"."` — see `packages/project-shell/docs/launch.md`), and then there is no suffix
anywhere. It is also what a reader sees first, and what a loader handed an absolute path
with no name to read has to go on.

`projectTypeOf` states the order in three lines: suffix, then declaration, then `st0`, which is
what a folder saying nothing is.

A folder named `.z0` that declares `type: st0` is not resolved silently. It compiles either way,
because the two signals feed different readers, and that is exactly why it is **reported** —
`projectTypeIssues`, surfaced beside `deadProjectFields`. A field that is accepted and ignored
is worse than one that is refused.

The values are `st0` and `z0`. A set declares nothing at the root: it is an `.st0`, and what says
what it is is the pair above — a `turntables` surface and the playlist it names. There is no
`project_type: live` beside it: a folder saying it has no arrangement while its `surfaces/` says
otherwise is a contradiction nothing can resolve.

`type` is a ROOT key, beside `trackOrder` and `markers`, and not a `project:` setting. The tier
inside `project:` is the SONG's own settings — its tempo, its rate. This is a fact about the
file's dialect, not a setting of the project.

## A deck is a lane with no arrangement

This is the one genuinely new thing, and it is small.

In a song, `nodes/bass.yaml` **is** the arrangement: the clips, where they sit, how often
they repeat. On a deck there is nothing to arrange — the material is whichever song from
the playlist was loaded onto it ten seconds ago, and it will be a different one in four
minutes. So it authors no `events:` at all.

The file still exists, and that is deliberate. The alternative — inferring the decks from
`graph.yaml`'s keys and writing no lane files at all — costs three things:

- st0 keeps a useful error for a chain naming a node that has no file, and inference
  would have to make that error conditional on the project's type;
- the file tree, the editor and the loader all work unchanged with a file there;
- the deck's **settings** need somewhere to live. Trim, cue, key-lock, which deck holds
  the master tempo: none of those are the song, all of them are the deck, and inventing a
  second home for them later is worse than having one now.

A deck's file is now an ordinary node — `extends: "@studio/track"` and its own
settings — which is the same argument arriving at the same place from the other side: a
node is exactly "one use of a module, with its own settings".

## Two decks meeting at a crossfade

The graph is the shape a chain cannot express on its own, because **a chain carries one
signal**:

```yaml
modules:
  deckA: [ tempoA ]         # the record, through its OWN tempo…
  tempoA: [ eqA ]           # …into the deck's bus
  stemBassA: [ cutBassA ]   # …and one lane per separated instrument
  cutBassA: [ eqA ]         #    through the cut that SUBTRACTS it, into the same bus
  # …drums, other, vocals alike, ×2 decks
  eqA: [ filterA ]          # the bus carries the strip
  filterA: [ fadeA ]        # …and ends on this deck's own fade
  fadeA: [ MIX ]            # which lands on the mixer's sum, like deck B's
  fadeB: [ MIX ]
bypassed: [ deckA, deckB, stemBassA, … ]   # every source is heard through its bus only
```

### The crossfader is TWO modules, and the engine is why

A fade is `signal × gain`, and a crossfader is two of them facing opposite ways. It reads
like an odd way to write one module — and it was one module, `@st0/audio/utility/crossfade`,
with two declared inputs and deck B arriving on the port called `#b`.

That shape **cannot be heard**. A module's second port compiles to a Tracktion sidechain, and
a sidechain reads a track only while that track also reaches an audible output. So a deck
feeding nothing but a crossfade is heard **beside** it, raw, at full level, with the fader
unable to take it away — and every way of removing it from the master removes it from the
crossfade too. Muting the lane, moving the send, disconnecting the device, muting the bus,
routing to a silent sink: five mechanisms, five measurements, one result, all in
[engine/moteur/docs/sidechain.md](../../../engine/moteur/docs/sidechain.md).

So each deck keeps its own fade, its own track and its own ordinary output, and the blend
happens where sums belong — at the mixer. Nothing has to be hidden from the master, which is
what makes the shape hold: `bypassed:` above still lists the SOURCE lanes, because those feed
a bus and would otherwise double, but neither bus is hidden from anything.

Each fade has **one** parameter and it IS that lane's gain, so its panel reads true on its own:
`0` silent, `1` full. The opposition is in the mapping, as a mirror:

```yaml
crossfade: { module: fadeA, param: Mix, invert: true, also: { module: fadeB, param: Mix } }
```

`also` is the one exception to "a control drives at most one param". It earns it by being
narrow — one second target, and the only transform allowed is `invert`, which mirrors the
control **in its own range**. What the rule was written against is a mapping whose halves can
do different things; a mirror cannot.

It was written the other way first: one `Mix` sent unchanged to both, and a `Side` on each
module deciding which way its gain ran. The sound was identical and the panels lied — `fadeA`
reading `Mix 100` while deck A was silent, because the number shown was the crossfader's
position and not the lane's level. A panel a reader has to convert through a second parameter
is a panel that will be misread, so the arithmetic moved to the one place that already knows
about both sides.

`@st0/audio/utility/crossfade` is not wrong and is not going away: on a chain where both its
inputs already live on one track, it is the right module. It is a desk, where they do not,
that it cannot serve.

**The tempo comes before the fade**, and the order is the signal path: a deck whose tempo
were applied after the fade would be stretched post-mix, along with the other deck.

### Each deck is FIVE lanes, meeting at a bus

The record, and one per separated stem. A stem you can fade on its own has to be a track of its
own — there is no fan-out in the document and no plugin with four inputs (again
[ports.md](ports.md)) — and each runs through a `stemcut`, whose gain is **negative**. So the five
summing at the EQ produce a SUBTRACTION: turn one up and that instrument leaves the mix, leave
them all at zero and what you hear is the record, sample for sample.

Five feeders is also what makes `eqA` a **bus**: a run breaks where two signals meet, so the EQ,
the filter and the crossfade become a chain with no `from`, which `nodeProject` materialises as a
return track fed by five sends.

**The meeting has to happen before the EQ**, and that is the whole reason the strip moved onto a
bus. Subtracting a raw stem from an already equalised mix leaves a residue shaped like the EQ, so
the cancellation would stop cancelling the moment somebody touched a knob.

And `bypassed:` now lists all ten sources rather than deck B alone. `out` is a parallel path, so
any lane feeding the bus is also heard raw beside it — which for a stem lane is worse than a
duplicate: it would add its inverted copy straight to the master.

**What `bypassed:` means for such a lane is not a mute.** It reads as one, and this page said for
two days that "muting still feeds sends", which is false: a muted track processes nothing at all,
so every one of these lanes fed its bus with silence and a set had no sound. The engine now reads
"muted, and exactly one send" as **route the track's output to that bus** — off the master by
having somewhere else to go, rather than by being silenced. The measurement is in
`engine/moteur/docs/editBuilder.md`; the word in this file is unchanged because it still says the
right thing to a reader of the graph: this lane is heard through its bus only.

The crossfade's second input is the case this does NOT cover. `filterB: [ crossfade#b ]` names a
port, which compiles to a sidechain rather than a send, and a sidechain source is heard on the
master like any other track — so deck B arrives beside the crossfade as well as through it, and
the fade cannot take it away. Taking that track off the device silences the sidechain too. It is
an open gap rather than a bug in this file: a run consumed by a port has no way, today, to be
heard only there.

The four files come from `playlist stems` (`@studio/commands`) — or, for a record put on
unprepared, from the desk itself, which is what `surfaces/desk.yaml`'s `stems:` line is for. What
the desk does with them either way is `packages/ui-turntables/docs/stems.md`.

**A set with one lane a deck** draws no stem column at all — which is the designed answer to an
unwired mapping, not a fault. `scripts/migrateSetStems.ts` gives it the eight lanes, the sixteen
nodes, the eight bypasses and the eight mapping lines, through the YAML Document API so every
comment in the files survives. Dry by default:

```bash
npx tsx packages/song/scripts/migrateSetStems.ts <projet>.st0 --write
```

The part it is easy to get wrong by hand is the DECK's own lane. One feeder makes the EQ a step
the signal goes through; five make it a meeting point, so every lane reaches it as a send. `out`
is parallel, so an unmuted deck A is heard twice over. The script adds it to `bypassed:` for that
reason; deck B is already there, ending on a port.

It deliberately does NOT write the `stems: true` line. A separation is minutes a song, so it
happens because a set asked for it. (And it never writes a chain: `system stems` holds that, once,
for the machine.)

The sixteen stem files are GENERATED rather than written out, because sixteen files spelled by hand
is sixteen chances to swap `bass` and `drums`. `stemNodeFiles` is exported and parameterised by the
decks for one caller beyond the scaffold — `scripts/migrateSetStems.ts`, which gives an older set
exactly the files a new one gets. Two spellings of these nodes would be two sets that behave
differently for no reason anybody could see.

### The tempo module is COLD

`@st0/audio/utility/tempo` is `cold: true` and `plugin: {type: offline}` — a tempo
change is a time stretch, a stretch has to know where the file ends, and there is no engine
plugin that stretches time (the engine hosts a Pitch Shifter and nothing else of that kind;
Tracktion warps a CLIP instead). So it is the offline shape: a pass writes the stretched
audio before the render. See [coldModules.md](coldModules.md).

That is also why it belongs on a DECK specifically. The cold rule is that such a module's
chain must draw from a file input — and a deck's source is a file on the machine's disk,
which is the one input whose whole length is knowable up front.

Two nodes, not one shared: each deck plays at its own BPM, and a param belongs to a use
rather than to a module. `Source BPM` is measured by the pass; `Target BPM` is what the desk's
tempo fader sets.

The tempo stays on the RECORD's lane alone, and that is deliberate. It is realised by warping the
clip, and the desk applies that same warp to all five clips of a deck (`withDecks`), so a tempo
node per stem lane would be four more nodes describing one fact. The binding resolves by TRACK for
an offline module, and the track it names is the deck's.

**Nothing about two is fixed.** `scaffoldSet` writes two decks because two is what a
crossfade takes; the format holds any number, and no code special-cases the names `deckA`,
`deckB` or `crossfade`. A third deck is a third track and a second meeting point. Hardcoding
the pair into the desk would have bought nothing — the graph view draws whatever the file says —
and would have made a four-channel set unsayable.

Derived, this is **two** chains and no chain called `crossfade`: the module has a single
flow feeder, so it is a step inside deck A's run rather than a meeting point of its own.
`scaffoldSet.test.ts` pins that, which is the cheapest way to notice if `#b` is ever lost.

## What plays is the compiled project

The desk fetches the compiled `ProjectDoc` from the machine's file service (`GET /engine-doc`),
fills in each deck's song, and sends it to the engine over its own socket. So the chains, the
`sidechainFrom`, and the crossfade's **baked DSP graph** are the compiler's — not an imitation
built in the browser.

Loading a song is therefore NOT a project edit. The decks' tracks are declared with
`events: []` exactly so a live choice can fill them without writing to the folder: a set list
is committed, what is on a deck right now is not.

**One thing still cannot be a module.** The tempo is `offline`, so it compiles to no plugin —
`example.st0` compiles to deckA carrying the crossfade and nothing else. The stretch stays a
warp on the clip the desk fills in, which is the only thing that stretches live. Making it a module
in fact means writing the cold pass, and that is a separate piece of work from this one.
