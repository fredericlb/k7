# What a command line offers — the providers, the classes, the clues

`commands.yaml` says what you TYPE; `commandSpec.ts` says what each argument may hold. Three
vocabularies sit side by side there and they answer three different questions:

| | question | where |
|---|---|---|
| `PROVIDERS` | what are the candidate VALUES, right now, in this project | `complete:` in the yaml |
| `PROVIDER_CLASS` / `ARG_CLASSES` | what KIND of thing is it, in one word, so a line reads as a coloured sentence | derived |
| `PROVIDER_HINT` / `CLASS_HINT` | what does this field accept, as a clue beside it | derived, overridable by `hint:` |

A provider reads live state off the `CommandHost`. `satisfies` rather than an annotation, and that
is load-bearing: an annotation widens the keys to `string`, which makes `ProviderName` `string`
too — so `PROVIDER_CLASS` checks nothing and the wire cannot name a provider at all.

**A failed read costs the completion, never the command.** Every provider that touches the disk
swallows its own error and answers with an empty list or an unranked one: a broken curve file, an
unreadable module folder, a repository that is not there. A provider that threw would take the
whole command bar down with it, and the command itself already has the refusal it needs.

## `modules` and `nodes` are not the same list

`nodes` is this project's **uses** of modules, by the name the chains call them — off the compiled
project, so a name it offers is one the chains actually hold (`packages/song/docs/nodes.md`).

`modules` is that same list **plus the inherited modules by ref**, because those are nameable
before any chain has used one and therefore cannot come off the project. The two providers exist
to make one line visible in the completion rather than only in the prose: a `@ref` names a shared
DEFINITION, and editing one is the module builder's job, not a `node …` verb's — it would write a
file every other project reads.

`@engine` refs are the exception on both sides and are NOT offered. That namespace is the plugin
scan, so its size is a fact about the MACHINE rather than about the song: a rig with four hundred
plugins puts four hundred entries in front of the dozen modules a project has. It is browsed
instead, in the file tree's Libraries tab. `baseModules` leaves it out as well: a scanned plugin is
what a LIBRARY's module extends to give it a face (`packages/song/docs/moduleNamespaces.md`), and a
node pointed at the raw `@engine` ref instead gets no panel, whatever the library draws for it.
`module own` is the one verb that takes an engine ref, and it asks `engineModules`, which holds
nothing else. The filter is on the vocabulary half only: a ref the project
already USES arrives through `collectPluginModules` and stays completable, because a node that
exists is a node its verbs have to be able to name.

Both are ranked by each module's `status:` (`packages/song/docs/moduleStatus.md`). The ranking
reads the **ref map** and not the compiled project — `status` is an authoring fact that never
reaches the engine, so it only ever lives on the files. A lookup rather than a list, so one read
answers for every name a provider offers.

A value is what is INSERTED, and in a chain project a node's is its uuid. So a provider may also
give a LABEL for the values a person cannot read — `PROVIDER_LABELS`, which `nodes` alone fills,
with the module and the place (`packages/song/docs/chainFiles.md`). `completionItems` carries it;
`completions` is the same list as bare lines, for a caller that has nowhere to show a label.

### The label on the wire

The file service's `/complete` answers a list of bare lines, and only that, unless the caller adds
`labels=1`. Then a LABELLED candidate comes as `{ line, label }` and every other one stays a bare
string, in the same list and the same order. Two choices, both forced by the file service (in pl8's
image) and st0's frontend shipping on their own:

- **Opt-in, not a new default.** An older frontend reads every entry as a string; handed an object,
  it loses the whole field's completion, not just the label.
- **Objects only where a label exists, not a parallel array.** Old projects and every other
  provider look exactly as they did, and a newer frontend meeting an older service — which ignores
  `labels=1` — reads the same list, since it already takes a bare string as an item with no label.

`projectApi.complete` (`packages/project-shell/src/project.ts`) asks with `labels=1` and hands
back items. st0's command bar LISTS a labelled value by its label, matches what is typed against
the label as well as the value (`auto-wah` finds the node), and INSERTS the value: the field holds
the uuid, and names the label beside it.

## The rest, and the one thing each gets wrong

- **`moduleAlternatives`** offers every alternative name in the project, deduped, and not the
  named module's alone: a provider is handed the host and not the half-typed line, so it cannot
  know which module was just named. The handler checks against the real module, which is where a
  wrong name has to be caught. Read off `loadModules` rather than `loadGraph`, which would also
  read every clip, sequence and curve to answer a question about names.
- **`alternatives`** offers every local branch EXCEPT the one you are on, which is not a
  destination.
- **`playlists`** walks `_playlists/` off `repoDir` and never `songPath`: a playlist belongs to
  the repository, so a project folder is the one place it cannot be. Names are the extension
  stripped, subfolders kept — `live/repet` is one name.
- **`clipTargets`** is the audio clips this project places, then its audio files, for material no
  clip has claimed. Tracks are deliberately absent and the handler refuses one by name:
  `track process` is the command for those. The rule behind it: never offer what the command would
  reject. It is the one provider with an explicit return annotation,
  because it reaches into `PROVIDERS` for `audioFiles`: inferring it would need the map's own
  type, which is what is being inferred.
- **`chains`** puts the project's own and the médiathèque's `@st0/` ones in one list, because the
  command takes either (`packages/audio-passes/docs/processChain.md`).
- **`curves`** reads off disk rather than off the compiled project: a curve nothing binds yet is
  exactly the one you are about to bind, and the document only carries the bound ones' baked
  points.
- **`surfaceTypes`** comes from the schema's own enum rather than being retyped. A fourth type has
  to be added there anyway — it is what the parser accepts — and a list kept in step by hand would
  offer a type the file would then be refused for. It takes no host, which is exactly why `type`
  is an enum at all: the set is the editor's, not the project's.
- **`sequenceFiles`** reads the folder, because a sequence's FILE id can differ from the midi-clip
  name `collectSequences` reports.
- **`audioFiles`** walks per completion so a file that just landed appears; hidden dirs and
  `node_modules` are skipped.

## The classes, and why a few of them surprise

`argClass` answers provider, else literal set, else scalar type, else `text`. `PROVIDER_CLASS` is
exhaustive over `PROVIDERS`, so a new provider must say what it names before it compiles.

- `alternatives`, `moduleAlternatives`, `chains`, `curves` → **choice**. A named thing picked from
  a closed list. Not `file`: an alternative is a branch and nothing on disk, and a chain is
  neither a module nor a path.
- `surfaceTypes` → **choice** as well, and for a sharper reason: the surface's file does not exist
  yet. Naming its type is what creates it.
- `clipTargets` → **file**. A clip id and an audio path are both material, and the palette colours
  material as a file — the same answer `sequenceFiles` gets, whose ids are likewise entities
  rather than paths.
- `playlists` → **file**. A playlist IS its file: there is no marker inside a folder, the
  extension is the whole rule.
- `nodes` → **module**. A node is drawn as a module is, because it is one, in use.

`CLASS_HINT` fills in for arguments with no provider and no `hint:`. `choice` and `text` are
deliberately empty — a set's values ARE its clue, and free text promises nothing — and so are the
four project-backed classes, whose provider always answers first.

## Checking a token before the handler sees it

`validateArgs` walks the declared args **positionally** and returns the first that does not fit.
Extra tokens are the rest-of-line an argument may swallow; missing ones are the handler's to
report, with its own usage line. Only ONE-token arguments carry a `type` at all — an argument that
swallows the rest of the line stays the handler's business.

The timecode check parses at **4/4 on purpose**. It checks the FORM of a position; asking the host
for the project's real signature would compile the whole thing just to reject a typo.

Everything the loader reads is **reported and not thrown**: an unknown provider name is logged and
dropped, an unknown `type` is logged and KEPT so the suite fails on it. A throw in
`loadCommandSpecs` would empty the whole catalogue over one typo in one line.

A `readable:` needs **both languages or neither**. A half-translated sentence shows a French list
with one English row in it, which reads as a bug rather than as a missing translation.

Trailing arguments may be `optional:` — see [optionalArgs.md](optionalArgs.md).

Only **single-token** arguments may carry a `type`, because a typed argument is matched
positionally. An argument that swallows the rest of the line is always last, and anything after it
is free text: `project marker new <timecode> <name>` types the timecode and nothing else, so a
spaced name cannot make it fail, and `node param <node> <param> <value>` is re-split by its handler
and types nothing at all.

## The palette fills one field at a time

`completions()` is asked for a whole line and answers whole runnable lines. st0's command bar wants
the values of ONE argument, so it slices the shared prefix back off — and the two ends have to
agree about where that prefix ends.

Two ways that slicing goes wrong, both pinned by `commandSpec.test.ts`:

- **The line must keep its trailing space.** That space is what tells `completions()` the command
  is settled and its arguments are being filled. Drop it and what is left is the bare command name,
  which reads as "still typing a name" — so opening a field offers command names instead of values.
- **The value cannot be pulled out by token INDEX.** That assumes a one-word command, so
  `track mute melody` hands back `mute`, and the palette looks like it is completing commands
  where it is completing arguments.

The dispatch rule is **longest prefix**, in `completions` exactly as in `runCommand`, so a
completion offers arguments for the command that will actually run. No command name prefixes
another today, so the rule is guarded rather than exercised.

## The wire carries the same two lists

`packages/web-protocol/types.ts` writes `ArgClass` and `ArgProvider` out for the browser, which
cannot import this module — it reads `commands.yaml` off disk. A test compares both unions to the
sources here, because the two failures are silent:

- a **class** added here and not there ships a kind the palette has no colour for;
- a **provider** added here and not there is one st0's right-click menu can never see. A class says
  what colour a field is; a provider says what the argument actually NAMES, and that is what the
  menu matches on to offer a track its own commands and not a sequence's.

## `readable:` — the sentence the palette lists

The palette LISTS these sentences and matches on them, so a command without one is a command nobody
can find by describing what they want, which is the whole point of the surface. The catalogue is
the only place that knows a command exists, so it is the only place that can notice the sentence is
missing — hence a test rather than a review.

| rule | why |
|---|---|
| both languages, neither empty | a half-translated catalogue shows one English row in a French list |
| not the command name again | it teaches nothing and matches the same letters the name already matches — two rows saying one thing |
| **60 characters at most** | the row is `sentence … name`, and the name has to stay readable at the right of it. A longer sentence is not a longer row: it is a truncated one, or a list that wraps into a wall over the minimap |
| no example, no full stop | `help` is the CLI's fuller line and carries "(e.g. …)"; this one is scanned in a list, where an example is noise and a trailing stop is a row of ragged dots |
| all different | two commands with one sentence are two rows a person cannot choose between |

The cap is also what keeps a description from drifting back into `help`: every line that ran past
it was carrying a caveat or an example rather than an action.

Every argument must ALSO end up with a clue — `argHint` never empty. A provider-backed or scalar
argument gets one for free; a free-text one has to write its own `hint:`, because "text" on its own
answers nothing, which is exactly the field you would otherwise have to run the command to
understand.

## A spec carries no fixed leading arguments

There is no `with:` — nothing lets a spec prepend arguments of its own before the user's so that
several verbs reach one shared handler. A verb that IS one setting of another verb is a fact for
the ARGUMENT to carry, not for the catalogue to bake in: `node param <node> nam <file>` rather than
a verb per file-valued param.
