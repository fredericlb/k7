# `label:` — what a module is CALLED

A module is named by its ref: `audio/delay/tape-delay`, `@st0/instruments/wurlitzer`. That name is
an address — it is what a chain writes down, what `extends:` resolves, and what a folder on disk is
called. It is a poor thing to read in a list of forty, and it is unchangeable in practice: renaming
the folder breaks every chain that names it.

`label:` is the other half. Free text, optional, and read by exactly one kind of consumer: whatever
DRAWS a module for a person to choose. The graph's `+` picker shows it in place of the ref's last
segment and searches it beside the ref, so a reverb you called *Grande salle* is found by typing
"grande" and by typing "reverb" alike.

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

Nothing else reads it. In particular the command bar's completions do not: they complete a ref into
a line of text, where a second name would be something to translate back by hand.
