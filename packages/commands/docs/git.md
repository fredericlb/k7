# The repository's verbs — commit, pull, status, the libraries, and "alternatives"

Everything in `src/git.ts` acts on the WHOLE repository the working directory belongs to, because
a workspace IS one clone. The one exception is `updateLibraries`, whose subject is the `_libraries`
submodule inside it — the section below says what that costs. `gitEnv` is the host's transport config merged over the process env: the
web host pins `GIT_SSH_COMMAND` to the per-user deploy key, and the CLI passes nothing. An
`undefined` env inherits `process.env`; a map overrides only the keys it names.

## Every network call is bounded

`push`, `pull` and `fetch` all carry a timeout. This code runs in the **file service's single
process**, so an unreachable remote would otherwise wedge the socket to the engine and the pattern
clock along with the request. When the bound is hit, git is killed and the call throws.

- `commitAndPush` **pushes last**, and a push failure does not pretend the landed commit did not
  happen — it comes back as `pushError` beside the sha.
- An empty `status --porcelain` listing is a clean tree, which is not an error: just nothing to
  commit.
- `pull` is **`--ff-only` on purpose**. There is no terminal to resolve a merge and nowhere in the
  web UI to fix conflict markers, so a diverged branch — or a dirty file in the way — fails cleanly
  with git's own message. Git prints a multi-line report and the last non-empty line is its
  summary, which is what the command log wants.
- `gitStatus` is **polled, not commanded**: it feeds the share badge. It fetches first, best-effort
  and bounded, keeping the last known counts when the remote is slow, and reports `tracked: false`
  when there is no repository or no upstream to compare against. `conflicted` is behind AND ahead —
  `pull --ff-only` cannot run, so the badge flags it instead of showing a count.

## `project libraries update` — the one verb whose subject is a SUBMODULE

The account's libraries are their own repository, mounted at `_libraries`
([file-service/docs/libraries.md](../../file-service/docs/libraries.md)). Publishing a module you
edited is the builder's Save; this verb is the other direction, and it is two steps, in this order:

1. **`submodule update --init --remote`.** `--remote` is the whole verb — without it, git checks
   out the commit this workspace already records, which is the opposite of updating.
2. **One path-limited commit** over `.gitmodules` and `_libraries`, saying which version the
   workspace now uses. Never pushed: which library version a song is built against is a fact about
   this workspace until somebody commits the rest of it.

Two mounts exist, because `ensureLibraries` makes two. A workspace that is a git repository gets a
**submodule**; one that is not gets a **plain clone** in the same place, which has no gitlink and
so is moved with `pull --ff-only` and recorded nowhere. `isSubmodule` reads `.gitmodules` to tell
them apart rather than guessing from the folder.

**A failure to record is not a failure to update.** The files have already moved by then, so it
comes back as `recordError` beside the new sha — the shape `commitAndPush` uses for a push that
failed after the commit landed. Reporting it as a refusal would send someone looking for an update
that already happened.

## An alternative is a branch, with the branch you left remembered

You are not "branching": you are trying another version of the song and either keeping it or
dropping it. The vocabulary is deliberately not git's.

Git has no notion of a branch's parent, so it is written to `branch.<name>.studioParent` — the same
per-branch config space `branch.<name>.merge` lives in, so it travels with the repository's config
and is invisible to anything that does not look for it. `parentOf` returns `""` when the key is
absent, which is what `config --get` exiting 1 means.

| verb | what it does |
|---|---|
| `newAlternative` | branch from here, and record where "here" was |
| `applyAlternative` | merge back into the parent and land there |
| `cancelAlternative` | throw away what it changed and return to the parent |
| `switchAlternative` | move to another one |

**Work in progress is committed, never refused.** `switch` does it and `apply` does it, for the
same reason: the last edits are usually the ones you are applying, and "commit them first" sends
you away to run a second command that would only produce this commit anyway. It is committed under
a generated name — `wip <timestamp>` — so nothing is lost and nothing has to be named in a hurry.
Named and not **stashed**: a stash is invisible from the branch you left it on, and the point of
switching is to come back and find your work where you put it.

In `apply` the wip commit lands **on the alternative, before the switch**, so the merge carries it
into the parent.

**The branch is left behind in both directions.** `apply` does not delete it — deleting would throw
away the history of a direction you might want to read again, and it costs nothing to keep. Neither
does `cancel`, which is destructive enough already: it is `reset --hard` plus `clean -fd`, which is
why the word for it is *cancel*, and why it refuses when there is no parent to go back to.

A failed merge **lands you back where you were** rather than on a half-merged parent: abort, switch
back, then rethrow. If the abort itself fails, the original message is the honest thing to report.
