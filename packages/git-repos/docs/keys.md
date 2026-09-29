# One deploy key, made by the machine that uses it

The key that opens a git host is generated on the machine that holds the working copies, kept
there, and never sent anywhere. `packages/file-service/src/sshKeys.ts` is the whole of it:
`ensureKey` makes the pair when it is absent — idempotent, so the common path touches nothing —
and `GET`/`POST /ssh-key` answer the public half for the screen that asks you to paste it at your
git host.

## Why one key per machine, and never a travelling one

The alternative is one studio-wide key, held by a service and fetched by each machine that needs
it. That buys **one key to register with a git host** instead of one per machine — real
convenience with several machines and a git host that wants each key added by hand. What it costs
is a private key in flight between two services, a bearer-only route to carry it, a `no-store`
header, a rule never to log it, and a directory mapping a service's token to the person whose key
it wants: all of it only to make the travel safe.

No service keeps the studio's git identity (`apps/pl8/docs/projects.md`), so there is nothing for a
shared key to be shared *with*: one machine, one key, made where it is used. The private half is
served by nobody and has no route to travel on. The price is that **a second machine needs its own
key registered at the git host** — a paste per machine.

## Writing a key file by hand, on Windows

`installKey` — which nothing calls, since no key is received (`docs/inventaire.md`) — writes the private half `0600` and, **on Windows, also breaks ACL inheritance**
(`icacls /inheritance:r /grant:r <user>:F`). This is not belt-and-braces: OpenSSH on Windows
judges a key by its ACL and ignores the mode entirely, so a key written with `mode: 0o600` alone
is refused with `UNPROTECTED PRIVATE KEY FILE` and the clone fails with a message about
permissions rather than about anything the user did.

`ssh-keygen` sets all of this itself, which is why the generating side does not need it and the
code that receives a key does.

The public half is written when it is sent, but it is not required: an OpenSSH-format private key
carries its own public half, so `ssh -i` works without a `.pub` beside it. It is written so that
`publicKey()` answers on the receiving side too.

## The URI vocabulary — `uri.ts`

**SSH only.** The per-user key above is what carries the privilege, so an https URI would
sidestep it entirely and then hang on a credential prompt. Two spellings are accepted,
`git@host:path` and `ssh://host/path`, and both patterns anchor on an alphanumeric first
character — a URI must never reach `git` looking like an option.

`normalizeGitUri` folds those two spellings into one comparison key, `host[:port]/path`, with no
`.git` and no SSH user, port 22 dropped, host lowercased. It matters because
`git@host:me/repo.git` and `ssh://git@host/me/repo` are the **same repository**, and the two
sides of this feature learn about it by different routes: pl8 from what a person pasted, the file
service from a checkout's `remote.origin.url`, which git may have rewritten. Comparing the raw
strings would clone a repository that is already there
(`apps/st0/frontend/docs/projects.md`).

It **throws** on anything `assertSshGitUri` refuses: a key derived from an unvalidated string
would be a key for something that must never be fetched.

`repoNameOfKey` exists as its own door because a normalized key is `host/path` and is *not an SSH
URI any more* — handing it back to `repoName` throws. That is correct of the validator: one that
accepted its own output would accept a bare hostname as a repository. Callers holding a
normalized origin — the file service reads one off every checkout — need this door instead.

## The ssh invocation

`sshCommand` builds the `GIT_SSH_COMMAND` every git subprocess runs with, and each option is
load-bearing:

| option | why |
|---|---|
| `-i <key>` | the key to offer |
| `IdentitiesOnly=yes` | stop a running agent offering the human's own keys instead |
| `BatchMode=yes` | fail rather than prompt — there is no terminal to answer |
| `StrictHostKeyChecking=accept-new` | pin the host key on first sight, into… |
| `UserKnownHostsFile=<dir>/known_hosts` | …**our** file, not the machine user's |

Paths are spelled with forward slashes because git splits this string sh-style even on Windows.

`gitEnv` adds the rest, and two of them are security rather than hygiene:
`GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` stop a personal `url.insteadOf` rewrite
from turning the SSH URI back into https — privilege and all — and `GIT_TERMINAL_PROMPT=0` makes
a missing credential an error instead of a hang.
