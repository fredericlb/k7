# Knowing what is in a repository without cloning it

st0 lists your git repositories and shows what is inside them, and it must do that on a
**hosted** machine that has no business holding your working copy. The working copy belongs
on the machine the engine runs on, where the file service puts it — that is where a file gets
edited, played and committed.

So st0 keeps a **bare, blobless mirror** instead:

```
git clone --mirror --filter=blob:none -- <ssh-uri> <dir>
git fetch --prune            # to refresh it
git ls-tree -r --name-only -z HEAD
```

Three flags, three reasons.

## `--mirror`, not `--bare`

Both give a repository with no working tree. Only `--mirror` writes a fetch refspec, and
without one a later `git fetch` lands in `FETCH_HEAD` and the mirror **silently never moves**
— you would be listing the repository as it was the day it was added, with nothing to say so.

## `--filter=blob:none`

This is what makes the whole approach honest rather than "a clone we don't admit to". A
partial clone with this filter downloads commits and **trees** — the directory listings —
and no file contents at all. A repository with a gigabyte of stems costs a few megabytes
here.

It works because of what project detection actually is. A l8 project is *a directory holding
a `project.yaml`*: `packages/song/src/yaml/moduleIO.ts:140` checks that the file **exists**
and never opens it. Detection is therefore a question about the set of paths, and the set of
paths is exactly what a tree is. Nothing here ever needs a blob.

If the section ever wants to show something from inside a file — a song's title, say — that
property is gone and this decision has to be re-made rather than quietly patched with a
`git cat-file`, which would fetch a blob on demand over the network, one round trip per file.

**A server that cannot do partial clone** refuses `--filter` outright, so `ensureMirror`
retries once without it. A full bare mirror is heavier but is still not a working copy, and
being unable to list a repository at all is the worse outcome. The retry deletes the debris
first: a failed clone leaves a partial directory, and a half-mirror that survives would be
served as if it were whole.

## `-z` on `ls-tree`

A path may contain anything except NUL, and git quote-escapes the awkward ones on output
unless you ask for NUL separation. Without `-z`, a file with a space or an accent in its name
comes back wrapped in quotes with `\303\251`-style escapes, and the tree grows a folder that
does not exist.

## What the mirror costs

Disk on the hosted volume, and one `git fetch` per refresh. Neither is free, so:

- the mirror is refreshed **when a repository is added, and on the refresh button** — not on
  every render. `useGitStatus` in l8 is on a ten-minute timer for the same reason
  (`apps/l8/frontend/src/hooks/usePolls.ts:33`);
- a mirror nobody has read for a while can be deleted. `ensureMirror` recreates it on the
  next look, so eviction costs a wait and never data.

## The tree that comes out

`buildTree` returns `FileNode[]` — the **same** type the file service serves from `/tree`
(`packages/web-protocol/types.ts:6`), including the `project?: boolean` flag on directories.
That is deliberate: st0's Projets section and l8's own file tree then draw the same rows from
the same shape, and "is this folder a project" has one spelling across the repo.

`-r` without `-t` lists blobs only, so directories arrive implied by the paths rather than as
entries of their own. Nothing is lost — git has no empty directories to forget.
