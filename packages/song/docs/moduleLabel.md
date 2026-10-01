# `label:` — what a module is CALLED

A module is named by its ref: `audio/delay/tape-delay`, `@st0/instruments/wurlitzer`. That name is
an address — it is what a chain writes down, what `extends:` resolves, and what a folder on disk is
called. It is a poor thing to read in a list of forty, and it is unchangeable in practice: renaming
the folder breaks every chain that names it.

`label:` is the other half. Free text, optional, and read only by what DRAWS a module for a person
— the picker, a card's header, the file tree:
the graph's `+` picker shows it in place of the ref's last segment and searches it beside the ref,
so a reverb you called *Grande salle* is found by typing "grande" and by typing "reverb" alike; and
a card's HEADER wears it, the node's own name underneath.

```yaml
label: "Grande salle"
plugin: { type: internal, name: Reverb }
```

## It names nothing

Nothing resolves through it. Two modules may carry the same label, a label may be changed at any
time, and a label that is blank or absent is the same state: the picker falls back to the name the
ref already carries, which is why a row is never empty. That fallback is `moduleDisplayName`, and it
is one function so a list and a search cannot disagree about what a row says.

This is the same posture as `status:` (`moduleStatus.md`): the only two fields on a module that say
nothing about what it does or how it sounds. Neither reaches the compiled `ProjectDoc`, so the
engine never hears of either.

## A node inherits its module's

A node is a module that `extends:` another, so the label resolves like any field: the node's own
if it has one, else its module's. The compile carries the result on the graph step as `moduleLabel`
(`label` is already the NODE's name there), and the header prefers it to any ref
(`packages/ui-chains-react/docs/nodeCard.md`). One label on the library module names every use of
it; a node that needs its own says so in its own file.

## It belongs to the module, not to an alternative

`label:` sits on `ModuleSchema` beside `status:` and NOT in `MODULE_FIELDS`, so an alternative
cannot restate it — a module's alternatives are ways of playing the same block, and "this way of
playing it is called something else" is not a thing anybody means. An alternative already has
`name:` for the one distinction it needs (`alternatives.md`).

## Two places it is edited, one field

**In the YAML**, like every other field. And **in the module builder**, in the box beside the status
dropdown, whose placeholder is the module's own name so the fallback is visible before you type.
That box writes `label:` into the file through `setLabelIn`, which CLEARS the field on an empty box
rather than writing `label: ""` — a module with no label is a module with no line, the same rule
`status:` follows for its default.

The builder reads it back off the BUFFER, not off the disk, so what the header shows is the edit you
just made and not the last save.

## Where it reaches

- `listBaseModuleRefs` puts it on `/base-modules`, which exists for the picker and is deliberately
  lighter than `hints()` — that is how a module the PROJECT owns carries its label.
- `moduleCatalogue` puts it on every inherited module, which is the picker's other half and the
  module builder's list.

- The graph compile puts it on each step as `moduleLabel`, which is how a card's header gets it.
- The file service's tree walk puts it on a module folder's row (`FileNode.label`), and st0's file
  tree draws it grey after the folder name, in the project tab and the Libraries tab alike. Read
  by `moduleRowLabel`, which caches it by the file's mtime: the tree is rebuilt on every revision
  and a label almost never changes. A module file that does not load shows no label rather than an
  error — the row still has to be there to be opened and fixed.

Nothing else reads it. In particular the command bar's completions do not: they complete a ref into
a line of text, where a second name would be something to translate back by hand.
