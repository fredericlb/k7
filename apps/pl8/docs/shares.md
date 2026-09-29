# Shares — pl8 hosts a frozen copy of a project

## A share is not a copy of a repository

[projects.md](projects.md) holds that *pl8 makes no copy of a repository*: the clone one edits,
plays and commits lives on the engine's machine, and "what is in there" is a question asked of
that machine. A share is a different object:

|  | what pl8 holds of a repository | a share |
|---|---|---|
| what it is | its NAME and its URI, a registry entry | **the original**, and the only one |
| who can remake it | re-registering costs a paste | nobody — the render happened once |
| what is written to it | nothing | nothing either: frozen the second it lands |
| when it goes | when the repository leaves its list | when its author removes it, and never before |

A share is **published content**, like a k7 release or a track in the media library — things this
service already hosts and is already the only copy of. What `projects.md` refuses is pl8 becoming
**the writer of everyone's repositories**, a change of security posture rather than a feature, and
serving frozen bytes someone sent touches none of it: pl8 pushes into no repository, holds no
working copy, and a deleted share loses only itself. The real price is not posture, it is
**disk**, and it is measured below.

## What a share is

A **frozen** version of a project, with no engine behind it. Everything audible is rendered in
advance: the mixdown, plus one file per audible track. The visitor opens st0 read-only, listens,
looks at the chains and the module parameters, and can break nothing because no process is waiting
behind to execute anything.

How the bundle is built and why it holds what it holds is opposite, in
[`packages/commands/docs/shareBundle.md`](../../../packages/commands/docs/shareBundle.md). This
page is only what pl8 does with it.

## Two identifiers, and only one touches a path

```
token = randomBytes(32).base64url     43 characters, the secret in the link
key   = sha256(token)                 64 hex characters, the folder name
```

The token is **never** a path segment. A path segment ends up in every access log, every
`Referer`, every proxy error message — and the link IS the whole of the protection. The key is
useless to anyone who did not obtain it by hashing a token they already held.

The secondary benefit is speed: a bad token names a folder that does not exist, so the comparison
is an `ENOENT`, O(1), with no index to load. That counts because it is the path of **every Range
request** an `<audio>` emits while seeking through a track.

`isKey` (`/^[0-9a-f]{64}$/`) is checked **before** any join. `safePath` stays the second wall and
not the first: it confines to the media library root, so `../../songs/private.wav` from `.shares/`
would pass it without a murmur.

## Where it lives

```
<media library>/.shares/
  index/<sub>.json          one person's list — one file per OIDC subject
  comments.db               what visitors wrote — the one database here (comments.md)
  blobs/<key>/
    pending.json            present = the draft is unfinished, so nothing answers
    snapshot.json           the manifest — present = the link is live
    project-doc.json  graph.json  surfaces.json
    audio/mix.wav  audio/s0.mp3 …
```

A **dot folder**, invisible for free: `writablePath` refuses any segment starting with `.` and
`revision.ts` does not walk them, so `.shares/` appears in no file API and no family sweep.
`.prefs`, `.projects`, `.hunts` and `.cache` live there for the same reason.

The index is a small JSON per person, named by `fileFor(sub)` — the arrangement of the preferences
and the repositories, and for the same reason: a list its owner alone WRITES needs no database.
`comments.db` beside it is the one thing on this volume that does not have a single writer, and
[comments.md](comments.md) is why that changes the answer.

**Index writes throw**, where reads never do, and they are written beside and renamed: a crash
mid-write must not leave an empty list, since the list is the only way its links are revoked. A read that fails means "no shares", a real state. A
write that fails in silence means a link its author is about to hand out and that this service
will **not** know how to revoke: the bytes are public and the only register that knew them just
failed to write.

## The routes, and the barrier

`apps/pl8/backend/src/server.ts` mounts, at line 115:

```ts
app.use("/api", requireAuth, preferencesRouter(…));
```

Everything mounted under `/api` **after** that line inherits the guard, silently;
`packages/engine-registry/mount.ts` documents exactly that trap. The two share routers are
mounted **before** it, each guarded explicitly:

| route | guard |
|---|---|
| `POST /api/shares` (draft), `PUT /:key/file`, `POST /:key/finish` | `bearerOrSession(requireAuth)` |
| `GET /api/shares`, `GET /revision`, `DELETE /:key` | the same — session in practice |
| `GET /:key/comments`, `PATCH /:key/comments/:id` | the same, and the share must be YOURS |
| `GET /api/public/share/:key/*`, `POST /:key/comments` | **none** |

The direction of failure is the right one: a badly mounted share becomes *unreachable*, not
*public*. `routes/shares.test.ts` mounts the routers **the way `server.ts` mounts them**, barrier
included and in its real place — the only test that catches the day someone reorders the `app.use`
calls. It also exercises the `isKey` guard **directly** on `..`, `../..`, `%2E%2E`…, because a
conforming client cannot send those cases: `fetch` resolves them away before a byte leaves. The
wall is real, a raw socket can still aim at it, and the direct call is the only place it can be
exercised.

The word `public` **in the path** is a comment that survives a refactor, and is not confused with
`/api/shares` by one character.

Everything sits under `/api/` because nginx only proxies `^/(api|auth)/`: the rest is
`try_files $uri /index.html`. There is no "outside `/api`" without touching the proxy. That
`location` already carries `proxy_buffering off` and `client_max_body_size 512m` — **no nginx
change on either side**.

### The public router ends in a terminal 404

Express falls through when nothing matches. Without that 404, an unknown key travels on to
`requireAuth` and answers **401** — "it exists but not for you" about something that does not
exist, which is both false and a leak.

The rest of its posture is headers: `X-Robots-Tag: noindex, nofollow` everywhere (a secret link
has no business in an index), `Referrer-Policy: no-referrer` (the token is in the address, so it
must not travel as a `Referer` towards whatever the page loads), `no-store` on the manifest —
revocation must be felt at the next load — and `immutable` on the bytes, a snapshot being
unchanging by definition.

The manifest is also the **allow-list**: `/doc/:name` and `/audio/:file` do not look for a file,
they look for a name **in the manifest** and serve what it designates. No request ever reaches a
path it composed itself.

The extension there is **optional**, and that is what lets the reader be st0 unchanged: `fget`
asks for `/project-doc` because that is the file service's route, and the snapshot calls the same
bytes `project-doc.json` because a file needs a name. Accepting both spellings costs one `||`;
teaching either side about the other would put a special case in the one place — the transport —
that must stay ignorant of who answers.

### One write got through, deliberately

`POST /api/public/share/:key/comments` is the only unauthenticated write this service takes, and it
is what makes a share a conversation rather than a broadcast. What bounds it — the lengths, the
ceiling per snapshot, the window per address — and why the comments are the one thing here kept in
SQLite rather than in a file, is [comments.md](comments.md).

## The upload is in three steps

pl8 does no multipart: `PUT /api/mediatek/file`, `POST /song`, `POST /recording` are all
`express.raw({type:"*/*", limit:"512mb"})` — *a 400 MB master has no business inside a form
parse* — and the global `express.json` is at 8 MB. Hence:

1. **draft** — `POST /api/shares`, the manifest as JSON: mints the secret, creates the folder,
   writes `pending.json` with the list of what is expected;
2. **one raw `PUT` per file**, whose `?path=` is **matched** against that list, never sanitised:
   the draft said what it would send, and everything else is not part of this snapshot. The list
   itself IS checked, when the draft opens: media are `audio/<name>` and documents a bare
   `<name>`, one segment of `[A-Za-z0-9._-]` that is neither `pending.json` nor `snapshot.json`.
   Every name is joined onto the share's folder, by this PUT and by the public reads, so a `../`
   in a manifest would be a write anywhere on the volume and a read of another person's index;
3. **`finish`** — writes `snapshot.json`, deletes `pending.json`, and **re-measures the sizes on
   disk** instead of believing the draft. What the link serves is what arrived.

`finish`, and it alone, makes the link live: an interrupted upload is never reachable, and a stray
`pending.json` is housekeeping rather than a leak.

The token is the **machine's** (`service:st0`, the one `npm run tokens` already writes for library
fetching). A service token has no person of its own, so **each** of the three calls names one with
`?user=` — the bargain [`sshKeyForService.md`](sshKeyForService.md) documents: whoever holds a
machine's token can act for anyone on it.

## Revoking

In st0, on its home page, **on the row of the project it came from**: a "Shares" button opening
that project's popin (`apps/st0/frontend/src/projects/ProjectShares.tsx`, the split being
`sharesForProject.ts`). Both ends of a share are st0 — it renders the bundle and sends it here,
and it takes it back.

**The bytes go first, the index is marked after.** That order is everything: deleting the folder
is what kills a leaked link, and it must depend on no write that follows. Idempotent, because a
second click is not an error.

**The row survives, dated.** A share that vanished from the list would leave its author wondering
whether it ever existed, and the sizes stay readable. The token is **erased from the register**: a
revoked row cannot be copied back off the screen that still draws it. **The comments survive with
it**, and the row still opens them: the bytes were the cost, the feedback is what it bought.

The confirmation names the two things that surprise: the bytes go at once and for good, and **a
link already sent cannot be un-sent** — it answers "not found" to everyone holding it, which is
the point, but republishing gives a *new* link. The address itself is drawn as a **link** and not
a button, because opening it is the only way to check what the others see;
`rel="noopener noreferrer"`, the page opposite being public.

## The risk with no ceiling

A bundle built on a real song — twelve tracks, `01.danse.st0` — weighs **484 MB** in wav. With no
expiry, on the volume that also carries everyone's media library. At that rate the failure is not
"shares stop working": it is "the studio goes read-only".

Settled by measurement: **the stems are mp3**, the mixdown stays wav because it is the only file
one downloads. About thirty times smaller, and a phone stops pulling 37 MB back to unmute a track.

Two defences are deliberately **not** taken:

- **the total is shown** at the head of the card — the cost is visible without anything being
  forbidden, and it is the only thing that can make someone decide to remove one, since none will
  leave on its own;
- **there is no per-author quota.** It stays the defence to take if this overflows, and it belongs
  to the **draft**: learning about a 507 at the 400th megabyte is the worst possible place to
  learn it.

## What only a deployment measures

Public streaming of real audio files behind the proxy. `proxy_buffering off` is set for the media
library, but a shared link is that path's only **unauthenticated** use, and that cannot be checked
from a development machine.
