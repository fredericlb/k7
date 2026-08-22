# clipIdentity.md — which clip is which, in a live edit

A `ClipDoc` carries two names, and they are not interchangeable:

| field | what it is | unique? |
|---|---|---|
| `id` | the PLACEMENT — `placementId(ref, start)` in the compiler | yes, by construction |
| `name` | the MATERIAL — `name: ref`, the clip or sequence being placed | **no**: shared by every placement of it |

The diff keys on `id` and is correct. The **engine projection** keyed on `name`, and that is the bug
this page is about.

## The wrong spelling, in three places at once

Tracktion clips are found again by their name, so a clip inserted into the edit has to be named
something the removal can match. All three sites spelled it the same way:

```cpp
juce::String(c.name.empty() ? c.id : c.name)   // insertClip, insertMidiClip, removeClipFor
```

which reads as "the id, falling back to the name" and does the opposite: `c.name` is the material and
is **never empty** for a real placement, so the id was never reached. Put the same sample down twice
and both engine clips answered to `riff`.

`removeClipFor` matches by name and stops at the first hit:

```cpp
for (auto* clip : clips)
    if (clip->getName() == name) { clip->removeFromParent(); break; }
```

so with a shared name it removed **whichever placement came first**, not the one the diff had named.

## What it sounded like

A paste makes a second placement of one material *by definition*, so this needed nothing exotic —
copy an event, paste it, then nudge either one:

1. Paste → the lane now holds two clips both named `audio_13_0`.
2. Move one → the diff correctly says *remove `audio_13_0@120.5`, add `audio_13_0@118.5`*.
3. `removeClipFor` matches the name and removes the **first** one — the original, at bar 26.
4. The stale clip stays in the edit and the moved one is added on top of it.

Heard as one event that is longer than it should be and **doubled from a certain point**, the two
copies overlapping at whatever offset the move introduced. Two properties made it hard to place:

- **It does not survive a reload.** A full rebuild puts back exactly what the document says, so
  anyone checking the file, the compiled doc or a render found all three correct. Only the *live*
  edit was wrong, and only after an incremental apply.
- **Nothing reported it.** `ProjectDiff::index` warns when two entries share an id — and the ids
  *were* unique. The collision was one layer further down, in the projection.

## The rule

`clipNameFor(const ClipDoc&)` in `ProjectDoc.cpp` is the single spelling, and it lives in the
JUCE-free data layer deliberately: it is a fact about the document's identity, it has to hold across
three call sites that cannot see each other, and putting it there is what lets
`studio_engine_tests` pin it without an audio device
(`clip_name_is_the_placement_not_the_material`).

**A fourth site that inserts or removes a clip must call it too.** Spelling the rule again is how
the first three came to disagree.
