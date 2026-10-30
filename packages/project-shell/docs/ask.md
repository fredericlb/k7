# Asking a question

`src/ask.tsx` — a confirmation, a one-field question or a choice between a few answers, as a promise.

```ts
if (await askConfirm({ title: "Retirer ce partage ?", body: …, danger: true })) revoke()

const name = await askText({ title: "Nouveau nœud", validate: … })
if (name === null) return          // cancelled — never "" for a cancel

const how = await askChoice({ title: "…", choices: [{ key: "update", label: "Update" }, { key: "reset", label: "Reset" }] })
if (how === null) return           // cancelled — no answer is ever picked for the person

const got = await askTextAction({ title: "…", actions: [{ key: "copy", label: "Copy" }] })
if (got === null) return           // cancelled
if (got.action === "copy") …       // `"confirm"` for the main button and for Enter
```

Render `<AskHost/>` once at the app root, beside `<Toaster/>`.

## Why it exists

Nine call sites had settled for `window.confirm` and `window.prompt`. They work, which is why they
lasted, and each one costs the same four things:

- **It is outside the app's Escape ladder.** `App.tsx` orders Escape — popin, then graph slot, then
  fullscreen, then panel — and an OS box knows none of that. It also blocks the main thread, so
  nothing behind it can even repaint.
- **It cannot be read.** The share consent was five lines of what leaves your machine, and the
  revocation four lines of what does not come back, both rendered in a box sized by the browser
  with no styling and no emphasis. The two dialogs that most needed reading were the two least
  readable.
- **It is in the wrong language and the wrong dress.** `EditorTab`'s delete confirmation was in
  English inside an otherwise French shell.
- **It validates nothing.** `ChainsBuilder`'s "new node" prompt went straight into
  `node new ${name}`, so a stray quote became extra arguments to a verb, and a missing `/` became a
  refusal from the other end of the app.

The alternative was a `Dialog` plus its state at every site — about thirty lines each, which is
what kept the native box attractive. `askConfirm`/`askText` cost one call.

## The shape is `toast`'s, deliberately

Same file next door, same idea: a module-level listener, one host mounted at the root, an
imperative call from anywhere. That is what lets a component deep in a package ask a question
without its host threading a callback down to it.

**No external UI library**, for the reason this whole package has none: it draws the gates that run
before an app is set up, and `toast.tsx` already hand-rolls its `cx` rather than import one. The
classes are Tailwind's over the design system's variables, which are global — so anything mounting
this needs `packages/project-shell/src` in its `@source` list, and k7 already has it.

## Two rules worth keeping

**A choice is not a confirm with a third button.** Its answers are peers — neither is the "safe"
one a dismissal could stand for — so Escape and the backdrop answer `null`, and the caller asks
nothing further. Enter takes the LAST answer, the one drawn as primary, since that is where a
keyboard expects it.

**One field, several things to do with it, is `askTextAction`** — the same dialog with extra buttons
before the confirm, answering the value AND which button gave it. `askText` keeps answering a bare
string: a second return shape on the same function would be a type every existing caller had to
unwrap. The extra buttons obey `validate` like the confirm does, since they act on the same value.

**A `tool` fills the field rather than answering**: one button left of Cancel that rewrites the
value in place (k7's tap tempo), with an optional key that presses it from anywhere in the dialog.
The key is caught by the dialog and stopped there, since it is typically one the app behind already
owns — Space is the transport — and a question that is open owns the keyboard. The button keeps
focus in the field, so Enter after a run of taps still answers.

**A dialog with no field takes focus itself**, or Escape and Enter would land on the page behind it
and reach nothing — a choice or a confirm would then answer only to the mouse.

**A cancel answers `false` or `null`, never `""`.** A caller cannot tell an empty answer from an
abandoned one, and `useShare` gets that wrong in a way that matters: cancelling the *title*
question after answering the *artist* one has to abandon the publish rather than fall through to a
default.

**The buttons speak the host's language.** This package holds no catalogue, so `<AskHost labels>`
takes the Cancel and Confirm words once, in the app's language, and a question's own
`cancelLabel`/`confirmLabel` still wins. Without them the words are English, the language of the
code, never a guess at the person's.

**With no host mounted, every question answers no.** A promise that never settled would hang the
caller for ever, and "no" is the safe half of every question asked here — the destructive ones
don't run, and the text ones return null.

## What it is not

One question at a time. A second call replaces the first rather than stacking, because a queue of
modal questions is a thing nobody asked for and a stack of them is worse. If two parts of the app
can ask at once, that is the bug.
