# The four checks no test would catch

Beside `biome`, `tsc` and the test suites, this repo runs four checks of its own. Two block, two
report a debt. Each guards a property the ordinary tooling has no opinion about.

| script | npm | blocks? | refuses |
|---|---|---|---|
| `scripts/check-source-bytes.mjs` | `lint:bytes` | yes | a NUL byte in a tracked source file |
| `scripts/check-doc-links.mjs` | `lint:docs` | yes | a `.md` naming a source file that is not there |
| `scripts/check-comments.mjs` | `lint:comments` | no | long headers, multi-line body comments, French where English is expected |
| knip | `lint:dead` | no | dead and duplicated code on the audio axis |

`lint:bytes` is the shortest and the least obvious: ripgrep skips a file containing a NUL byte
whole, so such a file stops existing for every sweep anyone runs afterwards.

## `lint:docs` — a page that points at nothing

The method of this repo is that the WHY lives in the prose: a comment points at a `docs/` page, and
the page points back at the code it is about. A pointer to a file that has been renamed or deleted
sends the reader into a wall, and nothing else notices.

It reads only what git tracks, and only paths that look like ours.

**What counts as "a path into this repo"** is anchored on the four TOP folders — `packages`,
`apps`, `engine`, `commons` — and deliberately NOT on `docs/` or `scripts/`. Those two are written
relative to the zone a page is talking about: the root `AGENTS.md` says `docs/picture.md` meaning
k7's, and moteur's `protocol.md` says `scripts/two-sessions.ts` meaning its own. A check anchored
on them would report a hundred sentences that are perfectly clear to a reader.

The pattern's lookbehind is what keeps `[stems.md](../packages/k7-plugins/docs/turntables/stems.md)` from being
read as a reference to `docs/stems.md`: a match may open on `../`, never in the middle of a path. A
reference is resolved from the repo root first — how nearly every page writes one — then relative
to the page, which is how a `../../packages/song/src/…` written inside a package's own `docs/`
resolves. (Spelling a whole example path here would make this sentence a broken link itself.)

**Two lists soften it, and both are meant to stay short.** `ALLOW` covers paths a page may
legitimately name although this checkout has not got them: a page inside `engine/k7-runtime` writes
`engine/EditBuilder.cpp` relative to its own app, and a page may name a file of `@frediverse/*`,
which is the commons submodule and may not be checked out. A growing list there is the check going
soft.

`TOMBSTONES` is the other one, and it is empty: a path listed there is exempted because the
sentence around it is about a file deliberately absent from the tree, and it is spelled out by hand
rather than detected, since a regex cannot be trusted to read that.

## `lint:comments` — where the prose lives

The three limits are in the root `AGENTS.md`: a file header of at most 10 lines, a body comment of
exactly one line, and English. It is non-blocking, like `lint:dead`: it reports a debt that predates
the rule and shrinks as files are touched. New code has no excuse.

**French is detected on FUNCTION WORDS, never on accents.** An accent test cannot
work: this codebase writes the names of its own things — the médiathèque, a dépôt, a chaîne —
inside perfectly good English sentences, so an accent test flags prose that is already fine and
never reaches zero. Function words are what a language actually is, and they also catch French that
happens to carry no accent.

**Quoted spans are dropped before the test.** The screens are in French, so an English comment
naming one quotes it — « Trouver des morceaux » is the button's name, not prose to translate. Only
the guillemet and double-quote forms are stripped, because the apostrophe is a French letter and
stripping `'…'` would eat the sentence around it.

One thing the rule forbids outright, and it is worth repeating here: **never turn a multi-line
comment into one line by joining its lines.** That produces an unreadable 500-character line and can
swallow a `biome-ignore` directive, which then silently stops working — a directive must start its
own comment. Condense to a single sentence and move the rest to a doc page.

## Why it scans blocks rather than matching line by line

A JSX comment's second line starts with PROSE, not with a marker:

```jsx
{/* The families moved from the side to the header, where k7 puts its views: the side is
    worth more as the current zone's tree than as three fixed buttons. */}
```

A line-by-line match sees that as one line and reports nothing, which leaves a whole class of
violations invisible. So `runs()` walks the file instead, opening on `/*`,
`/**` or JSX's `{/*` and closing on `*/`, and reports the whole run.

Two guards fall out of that. A run with no closing marker within 60 lines is a **template
literal**, not a comment — `gen-builtin-params.mjs` emits a generated file's own header inside one —
so the scan bails out rather than swallowing the rest of the file. And a **directive inside a run
of `//` lines SPLITS it**: a `biome-ignore` is not prose, and it may not share a line with any, so
the lines on either side are measured separately.

## A shebang looks like a body comment

Both `check-comments.mjs` and the ad-hoc counters skip a leading comment block as the file's HEADER.
A file starting with `#!/usr/bin/env node` has a first line that is neither blank nor a comment, so
the skip stops immediately and the header that follows is counted as body. The same happens to a
comment sitting under a file's imports. Neither is a real violation; the header rule is what
applies, and those headers are within it.

## `noUndeclaredVariables` — the one that only fails at runtime

Enabled in **studio's own `biome.json`**, not in `commons/biome.base.json`: that base is shared
with phare, and turning a rule on there is a decision for both repos.

An identifier used but never imported **parses fine**. `node --check` passes, the file loads,
and it dies on whichever branch first reaches it — so a build script can be green for weeks and
throw `ReferenceError` on the one path that matters. It happened here twice in one afternoon:
a guard added to `spike-job.mjs` without its `existsSync` import, and seven `node:fs` calls left
dangling when `build-engine.mjs` was split into `stage.mjs`. Both were only found by running the
exact path, on the exact platform.

Two settings go with it:

- `javascript.globals` declares `Terminal` and `FitAddon`, which `scripts/console/index.html`
  gets from xterm's `<script>` tags and biome cannot see.
- `!**/.tmp-*` is excluded from `files.includes`. Scratch scripts at the repo root are not
  source, and linting them put 86 errors in front of the five that are real.

## The pre-push hook

`.githooks/pre-push` runs `lint`, the two blocking checks and `test` before a push leaves the
machine. It is a tracked shell script rather than husky or lefthook: one hook needs no dependency.
`npm install` points `core.hooksPath` at it through the root `prepare` script,
`git config core.hooksPath .githooks || exit 0`. Every image's `npm ci` runs `prepare` too, from a
stage holding nothing but the manifests (`docs/images.md`), so it is one command and not a script
file — a file would not be there — and `|| exit 0` keeps it from failing where there is no checkout
or no git; both `sh` and `cmd.exe` read it. `lint:comments` and
`lint:dead` stay out of it because they report a debt rather than block. Biome skips JSON: much
of it is written by generators, whose spacing is not biome's.
`git push --no-verify` skips it.
