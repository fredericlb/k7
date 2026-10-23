# Agents in this repo

What an agent (Claude Code, mostly) is given to work here quickly, and why each piece is shaped the
way it is. The rules an agent follows are `AGENTS.md` and `CLAUDE.md`; this page is the tooling.

## A worktree is made ready by a script, not by memory

An agent works in a `.claude/worktrees/<name>` worktree of the WSL clone. A fresh one has an empty
`commons/` and no `node_modules`, and nothing in it lints or tests: biome's config extends
`commons/biome.base.json`, and `npx` with no local tool DOWNLOADS one from the registry.
`node scripts/agent/worktree-init.mjs [path]` fixes both, in under a second:

- **`commons/`** is checked out at the commit the branch records. Git refuses a local-path submodule
  URL (the Windows checkout) without `protocol.file.allow`; where even that fails, the clone's copy
  is taken, with its git link removed so `git status` stays clean.
- **`node_modules`** is a real folder of links to the clone's packages, EXCEPT the workspace links
  (`@studio/*`, `@frediverse/*`, the apps), which are recreated with their relative targets. A single
  link to the clone's `node_modules` would make every `@studio/*` import test the CLONE's code, so a
  change to one package would never be seen by the packages that import it.
- The tools' caches (`.vite`, `.cache`) are left out: a worktree has its own.

`paraglide/` needs nothing: every workspace's `pretest` and `pretypecheck` regenerate it.

## Hooks run it, and biome, without being asked

`scripts/agent/claude-settings.json` is the proposed `.claude/settings.json`. An agent may not
grant itself hooks or permissions, so a person installs it, by copying it there (`.gitignore`
lets that one file in). It holds:

- **The worktree init, on `PostToolUse` of `EnterWorktree` and on `SessionStart`.** There is no
  event for "a worktree was created": `WorktreeCreate` REPLACES git's creation and must print the
  path itself. The hook reads the worktree from its input's `cwd`; `$CLAUDE_PROJECT_DIR` stays the
  main checkout, so the script that runs is the main checkout's.
- **Biome on every file an agent writes** (`scripts/agent/biome-on-edit.mjs`). `AGENTS.md` asks
  every edited file to pass biome; a hook that exits 2 hands the report back while the file is
  still in front of the agent, instead of at commit time.
- **A read-only allowlist**: git queries, biome, vitest, tsc, the repo's lints and tests, and
  `tilt.exe get`/`logs`. Nothing that writes outside the tree, pushes or deletes.

## `npm run check:changed` checks what the branch touched

`npm run lint`, `test` and `typecheck` walk the whole monorepo. `check:changed` diffs against the
merge-base with `win/main` (where a branch is merged), then runs biome on the changed files, the
two blocking lints (`lint:docs`, `lint:bytes`, under a second together), and `typecheck` + `test`
of each workspace holding a changed file. `--dependents` adds every workspace that depends on one:
off by default, since a change to `song-schema` would otherwise test half the repo. `--dry` prints
the plan.

## `scripts/agent/win-verify.sh` runs one command on Windows

`scripts/agent/win-verify.sh <branch> <command...>` is the procedure of `CLAUDE.md` in one call: it
pushes the branch to `win`, checks it out detached in `C:\Users\flb\Src\k7-verify`, runs `npm ci`
when the lockfile changed since its last run, then the command, under Git Bash, from a script file
in `%TEMP%\k7-verify`. Never PowerShell, never a `cmd.exe` command line, for the encoding reasons
of `docs/dev.md`. It runs from the main session: a session isolated in a worktree is refused
Windows commands.

## What the isolation guard refuses

A session isolated by EnterWorktree has its git commands checked to stay in the worktree. It refuses
what it cannot prove: `git -C`, `cd` into the clone, `-c protocol.file.allow`, a command whose text
contains `.git` (so `.gitignore` too), a long inline heredoc, a `for` loop running a tool with a loop
variable, a `$(...)` subshell inside `time` or a compound. Write the script to a file and run that;
split chained commands into separate calls.
