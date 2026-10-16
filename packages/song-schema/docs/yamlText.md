# YAML options — one reading, one printing

`src/yaml/yamlText.ts` holds the options a workspace YAML file is parsed and printed with, so that a
writer cannot drift from its neighbours by re-declaring them.

- **`YAML_READ`** forces YAML 1.2. A file may declare `%YAML 1.1`, whose sexagesimals and true-like
  scalars (`on`, `yes`) collide with this app's own vocabulary.
- **`YAML_READ_LENIENT`** adds `strict: false`, for the readers that accept what the spec flags but
  the content does not need — chains, modules, ui panels. It changes which texts parse, never what a
  parsed text prints, so it is a reader's choice and not drift.
- **`YAML_WRITE`** is `lineWidth: 0`: a value is never folded, so a long line stays the one line its
  author wrote and a knob drag stays a one-line diff.
- **`editYamlText`** is parse → edit → print with those two. **`setKeepingFlow`** sets a value the
  way a person would expect: a list the author wrote inline (`[1, 2]`) stays inline.

## The writers that keep the default width

A few writers print with `String(doc)` — the library's default width of 80 — rather than
`YAML_WRITE`: the module file (`moduleFile.ts`), the desk's mix file (`mixFile.ts`), and a clip's
warp markers (`setClipWarp` in song-edit's `projectEdit.ts`). They are not moved over. Every file they have already written is folded at 80, and printing those at no width
would unfold each folded scalar on the next edit — a diff on a line nobody touched. The rule for
this module is that adopting it never changes a byte an existing writer would have written;
`yamlText.test.ts` checks that over the whole `demos/` and `k7-core/` corpus.
