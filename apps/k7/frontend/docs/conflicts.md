# Change notices and sync conflicts

How the editor learns that its workspace changed elsewhere, and where it shows an edit the live-sync
relay set aside. The relay's half is `../../../../packages/file-hub/docs/syncRelay.md`; what a
conflict is, `../../../../packages/live-sync/docs/sync.md`.

## Pushed first, polled as a net

`src/syncFeed.ts` holds ONE EventSource per page on k7's `/api/sync/events`, opened by the first
consumer and closed with the last, like the revision poll. A notice for the workspace the page edits
makes `hooks/useRevision.ts` ask `/revision` at once, which is exactly what its timer would have done
two seconds later: every consumer still reacts to the token, never to the notice, so there is one
way a change reaches a view.

- **The poll stays.** While the stream is open it runs every 30 s, a net for a notice lost in a
  reconnect; while it is not, every 2 s. A stream that comes back asks once at once.
- **A stream that cannot open is given up for the page.** An answer that is not a stream — a 401, k7
  served without the file hub — closes the EventSource, and three failures before it ever opened do
  the same: the browser would otherwise retry every few seconds for the life of the tab.
- **A share opens nothing.** A share has no workspace (`shared.md`), and the feed opens only
  for a page with a live one.

## Conflicts are shown where they are settled, and named where the value is edited

`src/syncConflicts.ts` keeps the workspace's open conflicts, read from the file service's
`GET /sync/conflicts` through the file hub like every file route. It is reread on every notice for the
workspace and on every revision move: the list is small, and a notice cannot say which conflicts it
closed elsewhere.

- **The footer tab appears only while there is one**, with the count. An empty tab would be a button
  that always says "nothing".
- **The panel shows each side as it is**: the YAML path and both values for a value; for a whole text
  "a whole version of the file", and "a binary version" for a blob ref, since a diff of either is
  not something to decide on in a side column. Who set it aside (the replica) and when.
- **"Use this one" and "Keep current" are the file service's `POST /sync/conflicts/:id`.** Both are
  ordinary entries in the log, so every replica closes the conflict at once and the history keeps it.
- **The editor of a file with an open conflict carries a banner** naming the paths, with the way to
  the panel. It sits above the editor rather than inside CodeMirror: a conflict is about a value in
  the room, not a range of the buffer, and the buffer may already differ from both sides.
