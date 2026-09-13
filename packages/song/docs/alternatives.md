# Alternatives — a module's other sets of attributes

A module can hold several sets of attributes and run one of them:

```yaml
# nodes/ampli.yaml
extends: "@project/audio/amp"
params: { Gain: 3, Tone: 5 }
alternative: crunch
alternatives:
  - name: crunch
    params: { Gain: 9 }
  - name: clean
    params: { Gain: 1 }
    plugin: { type: vst3, name: Twin }
```

The ⋮ button on the node's corner lists them, switches, and starts another. A LANE names the set it
is playing in the timeline's gutter too, and clicking that badge opens the SAME menu — one
behaviour reached from two places, not two (`apps/st0/frontend/docs/timeline.md`).

## The module's own fields are the first set

Not written down anywhere: the fields at the top of the file ARE alternative "1", and
`alternatives:` holds the ones after it.

Three things follow, and all three are why it is shaped this way:

- a module that never uses this keeps **exactly the file it would have anyway** — no wrapper key
  sits under everything;
- the first one **cannot be named**, because it has nowhere to carry a name. It answers to "1";
- switching back to it **clears** `alternative:` rather than writing `alternative: 1`, so
  off-then-on returns the file byte for byte.

## An alternative is an ordinary extender of its own module

`applyAlternative` is `mergeAuthored(module, chosen)` — the same merge a node gets over the
module it extends, and the same one `moduleResolve` runs. So the reading of every field is one
you already know:

- **`params` merge per entry.** A set that touches `Gain` leaves `Tone` alone, which is what
  makes an alternative worth writing: it states only what it CHANGES.
- **A list is a scalar to the merge**, so a set restating `events:` replaces the arrangement
  outright. It is the same rule that lets a node empty an inherited `automations:` with `[]`.
- **Any field may differ** — the plugin, the panel, the colour. An alternative is a module
  partial: `AlternativeSchema` is `ModuleSchema` minus `extends` and minus the alternatives
  themselves, spread from one shared `MODULE_FIELDS`, so a field added to a module is a field an
  alternative can set without anyone remembering to.

One thing is dropped before the merge: the alternative's **`name`**. It is in `OWN_ONLY`, so
leaving it in would rename the module to the name of its variant — and a module's name is the key
a chain calls it by. Silent, and it would repoint every step naming it.

## Order against `extends`, and why it is applied ONCE

`resolveModule` is two steps: fold the `extends` ancestry, then merge the chosen set over the
result. So an alternative always wins — it is the last thing said about the module.

The application happens at the **outermost** module only, which is why the recursion calls
`foldExtends` and not `resolveModule`. Applying it at every level would mean a parent's own choice
was merged in before the child's, and `base + clean + crunch` is not what `alternative: crunch`
says.

That leaves the useful case working: a node can pick from a list its PARENT declared. A
shared amp offers `clean`/`crunch`, and each use chooses — while a use that chooses nothing
inherits the parent's own selection, because `alternative:` is an ordinary inherited field.

## What SURVIVES the merge

`alternatives:` and `alternative:` ride through untouched. A resolved module therefore carries
both the chosen set (merged into its fields) and the list of what could be chosen instead — so a
surface draws the menu without a second read of the file.

They reach a node the ordinary way, on `WebChainStep`, and only **when there is more than one**: a
list of one is not a choice, and a node with nothing to pick from should grow no button. A LANE's
pair arrives by `WebGraph.trackAlternatives` instead, because a lane's node is built from the
graph's track side rather than from a chain step. That fourth track-side channel is the seam worth
collapsing next — a lane IS a module node
([trackModules.md](trackModules.md)), and this says so the long way round.

`trackAlternatives` has a second reader: st0's timeline names the set each lane is playing in
its gutter, and opens this same menu from it. It gets there from the chains pane rather than from a
field of its own on `WebProject` — one map for the badge and the menu means neither can name a set
the other does not. "Only when there is more than one" is what makes that badge free for every lane
that has no choice, which is nearly all of them.

## Not a preset

They overlap and they are different things, and the difference is what to hold on to:

| | a preset (`presets.yaml`) | an alternative |
|---|---|---|
| belongs to | the MODULE, so every node of it | the one module or node that holds it |
| holds | numbers — a module's `params:` | any field a module has |
| applying it | STAMPS the values in; the preset is not "current" afterwards | selects it; both sets survive and one is on |
| what it is for | a starting point | a state to switch between |

Neither replaces the other: a shelf of starting points and a pair of states you A/B are different
wishes.

## The three verbs

`node alternative select|create|copy <node> [name]`, and the ⋮ menu runs the same three. All
of them end in a project RELOAD rather than a patched doc pushed to the engine: a set may change
the plugin, the panel or a whole clip list, so there is nothing cheap to diff.

`create` is EMPTY by default, and that is not the empty-looking thing it seems: a set states only
what it changes, so an empty one is "the module as it is" and you then change the two knobs you
came to try. `copy` starts from what is ON — and from what that set STATES, not from the merged
result. Copying the merge would bake the module's own fields into the new entry, and every later
edit to them would then stop reaching it.

**A LANE is the exception, and it is `events: []`.** "States only what it changes" cuts the wrong
way for an arrangement: a set that says nothing about `events:` inherits them, so a new take would
open holding the previous take's placements — and a new take is empty. `newModuleAlternative` asks
`isTrack` of the RESOLVED module (`extends` folded; `loadModules` alone hands back the ref as a
string) and passes `blankClips`. Not for `copy`, whose whole promise is what is playing.

## Editing a lane that is on one — the fork

A lane's `events:` exists in two places at once: the module's own, which is set "1", and one per
entry under `alternatives:`. So "move this clip" has to say WHICH, and `yaml/trackFile.ts` answers
it twice, because reading and writing do not agree:

- **`clipsIn`** — what an edit ADDRESSES. A set stating no `events:` inherits the module's, so that
  is what is on screen and what a clip is picked out of.
- **`clipsToEdit`** — where it LANDS: always the selected set, copying the inherited list into it
  on the first write.

That copy-on-write is the whole of it. Writing `["clips"]` flat whichever set is on would make a
drag on alternative 2 rewrite alternative 1 — the arrangement you are not looking at — and the two
alternatives would never be separate documents at all.

Two details worth keeping:

- an index found in the list that is PLAYING still points at the same placement after the fork,
  because the copy preserves order. Every index-taking edit rests on that;
- the fork opens the set out into block style. An empty set is written `- {}` that way: a flow map
  keeps everything inside it on one line, and a forked arrangement would be a single
  400-character row in a file that is hand-edited and in git.

`color:` and `disabled:` are deliberately NOT forked: `setTrackField` writes the module's own,
because those describe the lane rather than the take.

A name is checked against the module it names, in the handler. The completion provider offers
every alternative name in the PROJECT, because a provider is handed the host and not the
half-typed line — it cannot know which module was just named.
