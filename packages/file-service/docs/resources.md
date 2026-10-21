# `GET /resources` — a project's imported media

`src/projectResources.ts` answers the resources panel (`apps/k7/frontend/docs/resources.md`): the
active project's audio and video CLIPS, by id, with their media path workspace-relative so the
browser fetches it back through `/media`.

## Read off the declarations, not the folder

It reads `clips/` through the same validated entity reader the compile uses, so a row is a clip the
project can place, and a file with no declaration — an upload that declared nothing, a picture's
extracted sound or proxy, a waveform cache — is never one. The kind is the source's extension, by
the same patterns the compile uses (`VIDEO_SOURCE`, `isAudio`).

## Takes are left out by their id

A recorded take is a clip in `clips/` like an import, and only its id tells it apart:
`<track>_<bar.beat>_<YYMMDDTHHMMSS>`, which `take-render`'s `recordTake.ts` writes. A clip named that
way by hand is left out too; the pattern carries a timestamp precisely so nothing else matches it.

## A missing file is listed, not dropped

A clip whose file is gone answers `missing` with no size: it is still placed somewhere, and a panel
that hid it would hide the one thing worth knowing about it.
