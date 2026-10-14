# shareOps.ts — the frozen snapshot `project share link` sends to the media library

Rendered on this machine, uploaded by the caller. Nothing here writes to the project: freezing a
shared copy is a RENDER, not `node freeze` ×N.

## The three documents, and why each is there

- **`project-doc.json`** (`WebProject`) is the arrangement. It carries `sourceName` — the audio
  file's NAME and never its path — so it says what a clip is called without saying where anything
  lives on this machine.
- **`graph.json`** (`WebGraph`) is the chains, the modules and their AUTHORED parameter values.
  That is the feature: "see the modules without editing them" is this document.
- **`surfaces.json`** is what the project DECLARES, verbatim. A project with a viewport surface is
  shared with that surface still declared and no video beside it; the snapshot says which media it
  carries (`media.video: false`) rather than editing the project's own claims.

## The three deliberately left out

`video-doc` carries workspace-relative media paths (`toWebVideoTracks`) and the share is
audio-only anyway; `project-errors` quotes file paths and lines of YAML; `/tree` and `/file` are
the source itself. A share shows the song, not the folder it was made in.

## The credential

Not the k7 publish's `.settings.json` pair but this service's own media-library bearer —
`mediatekBase()` / `mediatekToken()`, which the file hub hands it, minted for the account it serves
([mediatekLink.md](mediatekLink.md)). Sharing needs no plumbing of its own: this service talks to
the media library with it already. The user is still named on every call (`?user=`), which the
account's own token makes redundant and a `service:` token would need.

The upload streams from the rendered files, so they live until it is over and go whether it ended
well or not: a share of a long song is half a gigabyte of temp.

## Publishing to k7 is the other one

`project share k7` publishes a release to the rehearsal recorder's pages, on k7's origin or its
`k7.` alias. An unknown song throws `NEEDS_META`, which the route turns into a prompt for artist and
title. Its credentials sit at the WORKSPACE root — one k7 token serves every project in it.
