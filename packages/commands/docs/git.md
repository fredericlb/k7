# The repository's verbs — commit, pull, status, the libraries, and "alternatives"

Everything in `src/git.ts` acts on the WHOLE repository the working directory belongs to, because
a workspace IS one clone. The account's libraries are not in it, and the verb that updates them is
not here either — the section below says why. `gitEnv` is the host's transport config merged over the process env: the
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

## `project libraries update` — handed in, because its subject is the ACCOUNT

The account's libraries are repositories of their own, which the FILE SERVICE clones under
`<studioHome>/libraries/<name>` and keeps at their latest
([file-service/docs/libraries.md](../../file-service/docs/libraries.md)). Publishing a module you
edited is the builder's Save; this verb is the other direction — fetch every library now rather than
at the next open — and it is the file service's own sync, reached through
`CommandHost.updateLibraries`: the dependency runs file-service → commands, never back.

So the handler only SAYS what happened, one line per library by name, and:

- **refuses** on a host that hands no sync in, rather than reading as "up to date", and on an
  account with no library at all;
- **reloads the open song only when a library MOVED** (`updated` or `cloned`) — the modules it
  resolves through `@<library>/…` are different now. A library KEPT because it holds unpublished
  work is said, not reloaded for.

No workspace repository gets a commit: none records a library version any more. That used to be a
path-limited gitlink commit written here and in the file service both, and it is gone with the
submodule.

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
