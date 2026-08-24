# clipIdentity.md — which clip is which, in a live edit

A `ClipDoc` carries two names, and they are not interchangeable:

| field | what it is | unique? |
|---|---|---|
| `id` | the PLACEMENT — `placementId(ref, start)` in the compiler | yes, by construction |
| `name` | the MATERIAL — `name: ref`, the clip or sequence being placed | **no**: shared by every placement of it |

The diff keys on `id` and is correct. The **engine projection** is where the two can be confused,
and that confusion is what this page exists to stop.

## The wrong spelling, and how it reads as the right one

Tracktion clips are found again by their name, so a clip inserted into the edit has to be named
something the removal can match. This is the spelling to refuse:

```cpp
juce::String(c.name.empty() ? c.id : c.name)   // insertClip, insertMidiClip, removeClipFor
```

It reads as "the id, falling back to the name" and does the opposite: `c.name` is the material and
is **never empty** for a real placement, so the id is never reached. Put the same sample down twice
and both engine clips answer to `riff`.

`removeClipFor` matches by name and stops at the first hit:

```cpp
for (auto* clip : clips)
    if (clip->getName() == name) { clip->removeFromParent(); break; }
```

so with a shared name it removes **whichever placement comes first**, not the one the diff named.

## What that sounds like

A paste makes a second placement of one material *by definition*, so nothing exotic is needed —
copy an event, paste it, then nudge either one:

1. Paste → the lane holds two clips both named `audio_13_0`.
2. Move one → the diff correctly says *remove `audio_13_0@120.5`, add `audio_13_0@118.5`*.
3. `removeClipFor` matches the name and removes the **first** one — the original, at bar 26.
4. The stale clip stays in the edit and the moved one is added on top of it.

Heard as one event longer than it should be and **doubled from a certain point**, the two copies
overlapping at whatever offset the move introduced. Two properties make it hard to place:

- **It does not survive a reload.** A full rebuild puts back exactly what the document says, so
  the file, the compiled doc and a render all read correct. Only the *live* edit is wrong, and
  only after an incremental apply.
- **Nothing reports it.** `ProjectDiff::index` warns when two entries share an id — and the ids
  *are* unique. The collision is one layer further down, in the projection.

## The rule

`clipNameFor(const ClipDoc&)` in `ProjectDoc.cpp` is the single spelling, and it lives in the
JUCE-free data layer deliberately: it is a fact about the document's identity, it has to hold across
three call sites that cannot see each other, and putting it there is what lets
`studio_engine_tests` pin it without an audio device
(`clip_name_is_the_placement_not_the_material`).

**A fourth site that inserts or removes a clip must call it too.** Spelling the rule again is how
the first three came to disagree.
