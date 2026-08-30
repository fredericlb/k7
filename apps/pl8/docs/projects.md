# Projects — pl8 holds the REGISTER of repositories, st0 draws them

This service holds an account's list of git repositories, owns the single deploy key, and serves
`/api/projects`. It does not **show** them: the screen is st0's home page (`/`), and
[apps/st0/frontend/docs/projects.md](../../st0/frontend/docs/projects.md) is the page for
everything drawn. This one covers only what this service holds and why it is this one.

> **It does not say what is INSIDE.** That question belongs to the file service, which answers
> `GET /workspaces/projects` from the cloned workspaces — the working copy is on its machine, so
> the answer is too. What stays here is what no machine can hold: a list that belongs to a person.

`/api/projects`, `/api/shares` and `/api/projects/ssh-key` are served here, and st0 calls them from
the same origin.

## Why this service holds all of it

A repository belongs to a **person**, not to a machine. This service is the only one that outlives
every engine, holds a volume, and already knows how to name somebody: it is where everyone's
preferences, tokens and session live. An engine machine comes and goes, and can be reformatted one
evening without the studio losing an address.

## pl8 makes no copy of a repository

The copy you edit, play and commit lives on the engine's machine, and the file service is what
makes it.

The one heavy thing this service holds about a project is a **share** — a frozen, deliberately
published copy, of which it genuinely is the only copy. That is not an exception to the rule above,
and [shares.md](shares.md) opens by saying why.

### The folder's name is enough to answer

**The folder suffix names the application**: `mysong.st0` opens in st0, `partie.z0` in z0
(`packages/web-protocol/projects.ts` is the whole rule).

The NAME, not the content: "who opens this folder" and "can the engine be fed from it" are
different questions, and only the second needs to read a file. A folder name is a question about
the set of paths, and the set of paths is exactly what a git tree is.

`project.yaml` is what makes a project **compilable**, and `@studio/song` asks that question,
against a real working copy. A `.st0` with no `project.yaml` is listed, openable, and fails to
compile once opened, with st0's message. That is the right order.

**The file service applies this rule** (`isProjectDir`, `workspace.ts`), and it is the only one to:
listing and marking are the same code, on the same side.

> **The suffix is mandatory.** A project folder without one is not a project — the demos in
> `demos/` are called `synth-demo.st0`, `rack-demo.st0`…; their `name:` field stays unsuffixed,
> being their label and not their folder. A repository must contain **at least one suffixed
> folder**: a repository that *is* itself a project does not list, since its root has no name in
> the tree.

### What `GET /api/projects` answers

The register and nothing else: `id`, `uri`, `name` (the short name), `label`, `addedAt`.

**One caller reads it, for a precise reason.** st0's home page draws the machine's workspaces;
this register is what says whether the portable address `/<repo>/<project>` will resolve, since
`by-name` below is asked here. A copy the machine has and this register ignores opens through
`@local` and no other way.

### `by-name`: the short name becomes a URI, here and nowhere else

A project's address is `/<repo>/<project>`, so an editor arrives holding a **name** and nothing
else. It must emphatically not hold the URI: that carries a host, a port and a user, and an address
bar gets copied, bookmarked and pasted into a conversation. pl8 holds the repositories, so pl8 is
what turns the readable half into what you hand git.

An ambiguity is **not** "pick one": two repositories with the same short name answer 409 with both
URIs, and you open the project from st0's home page.

`by-name` and `libraries` are mounted **before** `/:id/*`. Neither is a repository id — they are
hashes — but a reader should not have to know that to be sure.

## The libraries repository is filed here too

An account declares **one**: the modules and chains all its projects inherit. It is registered like
the others — same SSH URI, same deploy key, same identity by normalised URI — and filed in the same
per-person file, under `libraries` beside `repos`. What differs is the verb: `PUT`, because there is
one of it. Setting it twice with the same URI must be setting it once.

One, not a list: it is mounted at a fixed path in every workspace (`<workspace>/_libraries`, see
[packages/song/docs/sharedFolders.md](../../../packages/song/docs/sharedFolders.md)), and two
repositories claiming that path is a question with no answer.

`libraries: null` is a **200**, not a 404: "none" is the ordinary state of a new account, and a
status code is the wrong place to keep the difference between that and a broken service. Only the
second deserves a diagnostic. st0 refuses to open a project without one, and says so on its home
page before cloning anything.

**An empty repository gets one empty commit, once**: on a project's first opening the file service
makes the missing root and pushes it (`initIfEmpty`), because a gitlink must point at a commit and
a repository created in a web UI has none. It is the file service and not pl8, for the reason just
below.

Nothing is seeded into it: a module is written in st0, against a project where the plugin it names
is actually loaded, and this volume holds none. The empty commit is the whole of that step.

## Why pl8 writes into no repository

**Making it a writer of every repository is a change of security posture, not a feature.** pl8
mints everyone's session and holds the single deploy key; giving it write access everywhere
concentrates everything in one place.

Beware the trap in the argument: "we cannot" would be false, and therefore brittle — fabricating a
commit in plumbing and pushing it is within reach of any clone, even bare and blobless. "We do not
want to" holds.

Creating and deleting a project therefore go through the machine's file service, which is also what
READS: the screen, the read and the write are on the same side.

## Why URI comparison is normalised

The two ends learn the address by different routes: pl8 holds what was **pasted**, the file service
has what git wrote in `remote.origin.url`. `git@host:me/repo.git` and `ssh://git@host/me/repo` are
the same repository; comparing raw strings would re-clone what is already there. `normalizeGitUri`
folds both spellings onto `host[:port]/path`, without `.git` and without the SSH user — and that is
also what gives a repository its `id`, so adding the same one twice does not make two.

## One key, and it travels

pl8 holds the studio's git identity: it generates the pair, keeps the private half, and the file
service fetches a copy over the channel the two services already share (`MEDIATEK_URL` +
`MEDIATEK_TOKEN`). **One deploy key to register with the git host**, instead of two.

What that costs and what fences it — bearer-only route, `no-store`, never logged — is in
[packages/git-repos/docs/keys.md](../../../packages/git-repos/docs/keys.md). It is an accepted
trade-off, not an oversight: read it before "fixing" it.

**Who** the machine asks for is a separate and more delicate question: the token a machine holds is
a service's, and a service has no key, while the key is filed under the person's OIDC subject. The
route therefore accepts a service token naming somebody, and pl8 holds the `email → subject`
directory linking the two spellings — [sshKeyForService.md](sshKeyForService.md).

## Where things live

All of it under a **dot-folder** of the volume, like `.prefs`: `writablePath` refuses it
(`packages/mediatek/src/layout.ts:203`) and `revision.ts` does not walk it, so none of it ever
appears in a family scan or in the file API.

```
<STUDIO_MEDIATEK>/.projects/
  repos/<slug>-<hash>.json      their repositories, and their libraries repository
  ssh/<slug>-<hash>/            their key pair
```

The file carries two fields, `repos` and `libraries`, and the write MERGES them: the two are edited
from two places on screen and nothing serialises them, so writing one half must not be able to
throw away the other.

The `<slug>-<hash>` naming is `@studio/user-prefs`'s (`fileFor`), taken as is: an OIDC `sub` is an
opaque string chosen by the IdP and can never be a path segment as it stands. The write, on the
other hand, **throws** rather than being silent like the preferences': losing a preference costs a
setting to redo, losing a repository just added returns a 200 for something that did not happen.

## What runs in the image

The pl8 container installs `openssh-client` for `ssh-keygen`, which makes the key pair. It never
calls `git`.

If a git call ever came back here, the hardening to take up is the file service's clone:
`GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` (a personal `url.insteadOf` would turn
the SSH URI back into https, privileges included), `GIT_TERMINAL_PROMPT=0`, `--` before the URI,
and bounded timeouts — `packages/file-service/src/workspaces.ts` applies them all.
