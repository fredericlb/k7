# Sharing a project — `project share link`, and the publish to k7

`src/shareLink.ts` runs the link, `src/shareSnapshot.ts` builds what it shares, and `src/shareOps.ts`
holds the two acts that render audio: the mixdown and the publish to k7.

## A share is a checkpoint, played by the server's engine

The link plays the project **as it was when it was shared**. That point is a checkpoint in the
workspace's history (`packages/file-hub/docs/history.md`), named `share: <project>`, so the author
sees in the history exactly which version went out. What they change afterwards is not part of
the share.

Nothing is rendered to audio. The server has an engine of its own (`docs/server-engine.md`), so the
share is the project's compiled document plus the files it names, and every visitor plays it live on
that engine in a session of their own (`apps/k7/backend/docs/media/sharePlayer.md`). Rendering the
whole song in advance cost minutes on every share and hundreds of megabytes of stems on the volume,
and it is unnecessary now that an engine can play the share live.

## The steps, and their order

One job per workspace. The editor starts it and then polls it (`POST` / `GET /share/link`, a
`ShareProgress`). The link is answered at the end and never earlier: until every step is done, the
bar is all the author has.

1. **Ask whether the server can play a share** (`GET /api/shares/player`). A server without its own
   engine refuses shares. It is asked first, before minutes of renders are spent on a share that
   cannot play.
2. **Render every VST track** (`AutoFreezer.renderAllNow`). The server's engine hosts no VST, so a
   track through one plays only from its automatic render (`packages/song/docs/autoFreeze.md`). Each
   missing render is made now, on the bound machine, whether or not the transport is running. A
   render that no connected machine can make fails the share and names the module and its plugin.
   It is refused rather than shared silent.
3. **Settle sync** (`settledSeq`): send every edit made here and wait for the server to order them.
   The seq that comes back holds all of them.
4. **Name the checkpoint** at that seq, through the hub (`/share/checkpoint`). The hub is the
   history's one writer, and `checkpoints.json` has no lock.
5. **Build from the checkpoint and not from the disk** (`/share/files`, then `buildShareSnapshot`). The
   hub answers the files at that seq, each binary as the path of its bytes in the blob store. They are
   laid out again in a temp folder and compiled there. An edit landing during steps 2–4 therefore
   cannot leak into the share.
6. **Upload** to the media library: draft, one raw `PUT` per file, finish.

The renders come before the checkpoint because they take the time, and the checkpoint should be as
close as possible to the moment the author asked. If an edit lands between the two and invalidates a
render, step 5 finds that VST freeze without its render and the share fails with "share again". The
other choice would be to render the checkpoint's copy, which the bound machine cannot reach: it lives
outside every tunnel root.

## What a share holds

- **`engine-doc.json`**: the compiled `ProjectDoc`, compiled for an engine with **no VST**
  (`compileWithAutoFreezes(dir, { vsts: "none" })`), whatever the account's last scan said. Every
  file it names is renamed under `k7-share:` (`SHARE_ROOT`): the server puts the share's own folder
  there when it plays it.
- **`src/`**: the checkpoint's copy of the project, with its workspace's shared files
  (`checkpointPrefixes`: `_modules`, `_presets` and the pins of every folder above it, and
  `_playlists`). The layout stays the workspace's, so a `../_modules` still resolves.
- **`home/`**: what the document names in the account's own folder, mostly the renders. The render
  cache is purged after a month unused, and a share does not expire. Only a FILE is copied, only
  when a typed path field of the document names it (a clip's source, a rack sound, a plugin's
  preset, IR, model, patch or Faust sound), and only from the account's library, renders and
  models: a share is public, and any other string of the document is text a song file wrote
  (`packages/song/docs/confine.md`).
- **The three documents a browser draws** (`project-doc.json`, `graph.json`, `surfaces.json`), built
  from the same compile. `video-doc`, `project-errors`, `/tree` and `/file` are left out, as before:
  a share shows the song, not the folder it was made in.

The libraries and the media library's songs are **not** copied. Their paths stay the server's own,
and the player reaches them as roots of its own. A pinned library version is frozen anyway; a
médiathèque song is the one thing a share does not freeze.

## Where it can be made

On the server, where the file service, the hub and the server's engine share one disk. The desktop
and the phone sync their workspaces to a server but make no shares themselves: their own backend has
no engine of its own, so step 1 refuses.

## The credential

This service's own media-library bearer: `mediatekBase()` / `mediatekToken()`, minted by the file
hub for the account it serves ([mediatekLink.md](mediatekLink.md)). Every call still names the user
(`?user=`), which a `service:` token would need. The hub's two routes take this service's hub
secret, which names the account, so a service reaches only its own rooms.

## Publishing to k7 is the other one

`project share k7` publishes a release to the rehearsal recorder's pages, on k7's origin or its
`k7.` alias. It does render: a release is a file. An unknown song throws `NEEDS_META`, which the
route turns into a prompt for artist and title. Its credentials sit at the WORKSPACE root: one k7
token serves every project in it.
