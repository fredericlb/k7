# shareOps.ts — the frozen snapshot `project share link` sends to pl8

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

Not k7's `.settings.json` pair but the machine's own pl8 bearer — `mediatekBase()` /
`mediatekToken()`, the `service:st0` token `npm run tokens` already writes into the supervisor's
settings for the library pull. Sharing needed no new plumbing: this service has been talking to
pl8 with it all along.

A service token has no person of its own, so the user is named on every call (`?user=`) — the
same arrangement, and the same accepted cost, that `/ssh-key/private` documents.

The upload streams from the rendered files, so they live until it is over and go whether it ended
well or not: a share of a long song is half a gigabyte of temp.

## Publishing to k7 is the other one

An unknown song throws `NEEDS_META`, which the route turns into a prompt for artist and title.
Its credentials sit at the WORKSPACE root — one k7 login serves every project in it.
