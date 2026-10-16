# Lints and conventions

## What blocks and what reports

| Check | Command | Blocks |
|---|---|---|
| Biome lint and format | `npm run lint` | `pre-push` hook, OneDev `lint and test`. Informational on GitHub. |
| NUL bytes in source | `npm run lint:bytes` | `pre-push` hook, OneDev `lint and test` |
| Dead file references | `npm run lint:docs` | `pre-push` hook |
| Typecheck | `npm run typecheck` | OneDev `lint and test`; GitHub runs `build` (which typechecks) instead |
| Comment limits | `npm run lint:comments` | Nothing: a backlog report |
| Dead code | `npm run lint:dead` | Nothing: a backlog report |
| Panel binds | `npm run lint:panels` | Nothing: needs the external plugins installed |
| Module panel layouts | `npm run lint:layouts` | Nothing: run after editing panels |

The `pre-push` hook (`.githooks/pre-push`, enabled by the `prepare` script) runs `lint`,
`lint:bytes`, `lint:docs` and `test` in that order and stops at the first failure. Skip it once with
`git push --no-verify`.

## Biome

`biome.json` extends `biome.base.json` from the `commons` submodule (so `commons` must be checked
out for `npm run lint` to work). The base config:

- uses the VCS ignore file, two-space indentation, an 80-column line width, double quotes;
- enables the `recommended` rule preset, with a set of rules lowered to warnings (React hook
  dependencies, several accessibility rules, `noArrayIndexKey`, `noAssignInExpressions` and others);
- disables CSS formatting and linting;
- forbids importing `lucide-react` directly (`noRestrictedImports`, warning level): icons come from
  `@frediverse/ui/icons`.

The repository's `biome.json` adds:

- **Excluded paths**: `commons`, `k7-core`, `engine/k7-runtime`, every `node_modules`, `dist`,
  `out`, `storybook-static`, `*.css`, `*.json`, `*.jsonc`, `*.min.js`, `*.tsbuildinfo`,
  `package-lock.json`, and `.tmp-*` (throwaway codemod scripts, also gitignored).
- `correctness/noUndeclaredVariables` as an error, with `Terminal` and `FitAddon` declared as globals
  (used by the console page).

Run `npm run lint:fix` to apply safe fixes and formatting. Generated files are formatted on
generation: `gen:builtin-params` runs `biome format --write` on its output.

## `lint:bytes`: no NUL byte in a tracked source file

`scripts/check-source-bytes.mjs` reads every tracked `ts`, `tsx`, `mjs`, `cjs`, `js`, `jsx`, `cpp`,
`hpp`, `h`, `rs`, `md`, `yaml`, `yml`, `json`, `css` and `html` file and fails on any NUL byte,
reporting the file, the line of the first one and the count. ripgrep treats such a file as binary
and silently skips it, so it disappears from every search. Write the `\0` escape instead of the
literal byte.

## `lint:docs`: no reference to a missing file

`scripts/check-doc-links.mjs` scans every tracked and untracked-but-not-ignored `md`, `ts`, `tsx`,
`mts`, `mjs`, `cjs`, `js`, `jsx`, `cpp`, `h`, `hpp`, `kt`, `rs`, `k7x`, `glsl`, `yaml`, `yml`, `sh` and
`py` file, outside `commons/` and build output. Any text that looks like a path into one of the
four top-level code folders (`packages/`, `apps/`, `engine/`, `commons/`), ending in a file extension,
must name a file that exists, either from the repository root or relative to the file containing it.

A few patterns are allowed without existing: engine-relative paths that do not start with one of
the engine's real subfolders, a handful of `commons` package paths a shallow checkout may lack, and
anything under a `dist/` folder. A path that names a deleted file on purpose can be listed in the
script's `TOMBSTONES` set.

This applies to this guide too: every `packages/…`, `apps/…` or `engine/…` file path written here
must exist.

## `lint:comments`: comment size and language

`scripts/check-comments.mjs` checks tracked `ts`, `tsx`, `mjs`, `mts`, `cpp`, `h` and `hpp` files
(outside `commons/`, generated files and Paraglide output) for three rules:

| Rule | Limit |
|---|---|
| File header | The comment block a file opens with (after a shebang, `#pragma once` or an include guard) is at most **10 lines**. |
| Comments in the body | Every comment after the header is **one line**. A multi-line `//` run or `/* … */` block is a finding. Directive comments (`biome-ignore`, `@ts-…`, `eslint`, `prettier-ignore`, `NOLINT`, `clang-format`, `<reference`) are exempt and split a run. |
| Language | Comments are in **English**: a comment line containing common French function words is a finding (quoted spans are ignored). |

It exits non-zero when it finds anything, but no hook or CI job runs it: it reports a backlog that
predates the rules. New and edited code should pass it. Long explanations belong in a documentation
page, with the code pointing at it in one line. Do not satisfy the rule by joining a multi-line
comment into one long line: that can also swallow a `biome-ignore` directive, which only works at
the start of its own comment.

## `lint:dead`: knip

`knip.json` configures [knip](https://knip.dev) 6 over the workspaces, ignoring `commons/**`:

- test and bench files are entry points through the Vitest plugin;
- per-workspace entries cover scripts and generated files knip cannot reach by imports (root
  `scripts/**/*.mjs`, `engine/k7-runtime/scripts`, `packages/song/scripts`,
  `packages/song-schema/src/builtinParams.generated.ts`, `packages/dsp/modules/**/jsdsp.ts` and others);
- binaries used from scripts (`cmake`, `ctest`, `ffmpeg`, `tilt`, `where.exe`, `osascript`) and a few
  tool dependencies (`tsx`, `concurrently`, Vite plugins, `esbuild`, `yaml`) are ignored.

It is a report, not a gate. Check a finding before deleting code: an entry missing from `knip.json`
looks exactly like dead code.

## `lint:panels` and `lint:layouts`

| Script | Checks |
|---|---|
| `lint:panels` (`packages/song/scripts/checkPanelBinds.ts`) | Every control a library panel binds against the parameters its plugin really exposes. Built-in plugins are read from the generated parameter list; an external plugin is instantiated by the engine's `--dump-params-ext`, so this only runs where that plugin is installed. Options: `[library root] [--only <filter>] [--json]`. |
| `lint:layouts` (`packages/ui-module-builder/scripts/checkLayouts.ts`) | Every library module's panel against the two-layout rules and the AI brief's checks, and against the committed version: a reworked panel must keep every control it had. Default target: all of `k7-core`. Exits 1 on any issue. |

## Coding conventions

These follow from the configuration and the checks above.

| Convention | Enforced by |
|---|---|
| Formatting: 2 spaces, 80 columns, double quotes, LF line endings | Biome, `.gitattributes` |
| Icons come from `@frediverse/ui/icons`, never `lucide-react` directly. A component that resolves an icon by name at runtime uses `@frediverse/ui/icons/all`, which is loaded as its own chunk (see `apps/k7/frontend/src/lucideIcons.ts`). | Biome `noRestrictedImports` |
| File header of at most 10 lines: what the file does, and what a reader would get wrong | `lint:comments` |
| One-line comments in the body; longer rationale goes to a documentation page | `lint:comments` |
| Comments and documentation in English | `lint:comments` |
| A file path cited in a comment or a page must exist | `lint:docs` |
| No NUL byte in source | `lint:bytes` |
| Packages are imported only through their `exports` subpaths; add a subpath rather than deep-importing | Module resolution |
| Relative imports include the `.ts` extension | `allowImportingTsExtensions` in every package `tsconfig.json` |
| npm scripts set environment variables through `with-env.mjs`, not `VAR=1 cmd`, so they run on Windows | Review |
| Every edited JS or TS file passes Biome | `pre-push` hook |
