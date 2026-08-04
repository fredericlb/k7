# Eviction — keeping a cache under a budget

`docs/sync.md` ended with this open: *"Whether a cache should also drop things it simply
has not used, and on what budget, is a policy question with no obvious answer for video,
and it is deliberately not answered by this module."*

Here is the answer, and the reasoning is more useful than the code.

## Why one global budget would have been wrong

The families do not resemble each other, and a single number would be wrong for all three
at once.

* **`modules`** is the *vocabulary*. Any chain may name any module, and one that is missing
  fails a project to load — not degrades it, fails it. The whole family is a few megabytes
  of YAML and the occasional `.nam`. Evicting from it trades nothing for nothing.
* **`songs`** and **`samples/audio`** are named by particular songs. A miss costs a
  re-fetch before that song plays.
* **`samples/video`** is what forces the question at all, and is the one place a budget
  earns its complexity.

So `EvictionPolicy` is `Partial<Record<Family, bytes>>` and **a family absent from it is
never evicted**. `modules` is expected to be absent. That is the default, not an oversight.

There is deliberately **no repo-wide default policy**. A budget is a property of a machine —
a laptop on tour and a studio desktop want different numbers — and choosing one here would
be choosing it for a disk this code has never seen.

## Least recently FETCHED, and saying so

The word "LRU" would be a lie, so it is not used.

Nothing in this repo records that a file was *played*. The moteur opens paths and tells
nobody; access times are unreliable in practice (Windows disables them by default, Linux
mounts `relatime`). So the only signal available without new plumbing is a cached file's
local mtime — which, for a downloaded file, is exactly when it was fetched, since the bytes
were written fresh and nothing rewrites them in place afterwards.

That gives **least recently fetched**, and its weakness is precise: a file downloaded once
and played every day looks identical to one downloaded once and never touched. Fixing it
needs an access ping from whoever opens a file — a real change, and a larger one than this.
Naming the weakness is worth more than hiding it behind three familiar letters.

Mitigating it, for now: a re-fetch is a *cost*, not a loss. Everything evicted still exists
on the server, and the next sync brings it back.

## The trap: the manifest has to forget

This is the part that would have been a real bug, and it is not about eviction policy at
all.

`diff()` compares the owner's manifest against **what the cache remembers it holds** — not
against the disk, for the reason `sync.md` spells out. So a file deleted from the cache
without being removed from that remembered manifest is a file the cache believes it still
has, permanently. It would never be re-fetched. The moteur would find a missing path while
the catalogue insisted everything was fine.

`evictFamily` therefore rewrites the manifest, and the two tests that pin it are the two
that matter:

* the evicted entry is **gone** from the remembered manifest;
* an entry whose file could **not** be deleted is **kept** — undeletable means still on
  disk, and forgetting it would have the cache re-fetch over a file it is already carrying
  and under-report its own size for ever after.

## A file bigger than the whole budget is still dropped

The budget is a promise about a disk. One 8 GB video must not be able to void it by being
larger than the allowance — so the loop drops rather than makes an exception. The result
can be an empty family, which is the honest outcome of a budget smaller than its contents.

## It is not automatic

`syncFamily` does not call this. Nothing does, yet — it is a function a settings screen or
the supervisor calls with a number a human chose.

That is on purpose. A musician on stage with a full disk losing the video they are about to
play is a worse outcome than a full disk, and an eviction that ran by itself during a sync
would be exactly that. `familyBytes()` exists so a UI can show the number beside the budget
before anyone commits to one.
