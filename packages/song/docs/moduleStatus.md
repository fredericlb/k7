# `status:` — how the completions treat a module

A library grows past the point where every module in it deserves equal billing. Half of a
project's modules are the ones you name every day; the other half are a compressor somebody
wrote once, a test rig, an experiment kept for reference. The palette offered all of them in the
same alphabetical wall, so finding the one you meant was a scroll rather than a choice.

`status:` is the field that says which is which. Three values, and one of them is the absence:

| value | what the completions do |
|---|---|
| `listed` | offer it, in the order it already had — **the default, and never written** |
| `favorite` | offer it **first**, above everything listed |
| `hidden` | do not offer it |

## It changes nothing but the offer

This is the only field on a module that says nothing about what it does or how it sounds. A
`hidden` module still loads, still resolves through `extends`, still plays, and can still be
**named** — in a chain step, in a command, by hand in the YAML. A completion list is an offer,
never a validator, and that is what keeps this an ergonomic setting rather than a way to break a
project from a dropdown. Hiding a module you are using costs you its completion and nothing else.

It follows that nothing downstream of the loader reads it: it never reaches the compiled
`ProjectDoc`, so the engine has never heard of it.

## The default is never written

`listed` is what a file says by saying nothing, and setting a module back to `listed` **removes**
the line rather than writing it. This is the rule `type:` already follows — the loader applies
the default, so the file stays as terse as it was authored. A library where every module carries
`status: listed` is one line of noise per file that every reader has to learn to skip.

## It is the module's, not an alternative's

`status` sits on `ModuleSchema` directly and deliberately **not** in `MODULE_FIELDS`, which is
what an alternative may restate. A module's alternatives are ways of playing the same block
([alternatives.md](alternatives.md)); "this way of playing it is hidden from the palette" is not
a thing anybody means. One fact about the module, said once.

For the same reason it is read off the **authored** module rather than the resolved one. A base
being hidden is a statement about the base — a module extending it has its own answer, or takes
the default. Otherwise hiding one shared amp would silently empty the palette of everything in
the library built on top of it, with nothing on screen to say why.

## Where it is applied

Once, for both completion surfaces, so they cannot come to offer different lists:

| surface | reads |
|---|---|
| the YAML editor's chain wiring and `bypassed:` | `hints.modules` (`src/hints.ts`) |
| the command bar's `<module>` arguments | the `modules` provider (`@studio/commands`' `commandSpec.ts`) |

Both call `completionOrder` in `src/moduleTypes.ts`, which is **stable within each group**: it is
handed an alphabetical list and gives one back, in two blocks. Sorting there would be a second
ordering rule competing with the caller's.

`moduleStatusOf` is deliberately forgiving — an unreadable module, a misspelt value, a half-written
file all answer `listed`. Losing a module from the palette with nothing to explain it is the one
failure this field must not have, so the fallback is always "offer it".

## Writing it

The module builder's header carries the dropdown, beside the module's name and path — the
altitude of the thing it is about, which is the module as a **catalogue entry** rather than as a
sound. `favorite` is drawn **first** there: what the setting does is put the module at the top of
the completions, and someone choosing between three options wants to read the effect rather than
the sentiment. The file keeps the schema's own three words.

The read/write pair is `statusOf` / `setStatusIn` in `@studio/ui-module-builder`'s `moduleUi.ts`,
working on the buffer's **text** like everything else there — so the dropdown shows the edit you
just made, saved or not — and going through the YAML Document API, so the comments and key order
of a hand-written file survive being set.
