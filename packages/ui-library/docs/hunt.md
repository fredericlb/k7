# The Find page

`src/FindSongs.tsx` is the screen of "Find songs": what is typed, what is asked of MusicBrainz and
slskd, how a peer is chosen and how the bytes come back are the server's, in
[apps/k7/backend/docs/media/hunt.md](../../../apps/k7/backend/docs/media/hunt.md). This page is
only why the screen is the shape it is.

## A page, not a dialog

`find` is a **section** in `routes.ts`'s sense, and the host draws it as an entry of its own nav —
in k7, the home sidebar, beside the families. It has no tree and nothing on the volume, so it
draws edge to edge.

A dialog would have been the reflex — it is what adding a song does — and it would be the wrong
choice: **the history grows**. A hundred rows in a window 85 % of the height is a screen scrolling
inside a screen. And a page brings three things a modal cannot: an address you can reload and
bookmark, a back button that returns to the songs, and the full available height.

The search field is at the top and **does not scroll**: building a library means one title after
another, and a field you had to go looking for after thirty rows would be a round trip per song.

Two consequences in `useLibraryData.ts`, both easy to miss:

- `find` is **not a family**: nothing it shows is on the volume, so the poll must never ask the
  server for a list of `find`, and the library's data hook skips it by name.
- Refreshing the catalogue after a song is filed cannot be the general `refresh`, which invalidates
  the **open** section's token — and that is `find`. What has just arrived is in `songs`: that is the
  token to clear, or the song would only appear on the next section change.

## What the rows say

Three colours for four states, because "searching" and "downloading" are both "in progress" to
whoever is watching. The detail shown changes with the state: while downloading it is **who** is
sending and which peer number, on failure it is **why** — the whole chain of causes the server
joined — once filed it is **where**, and the format obtained, said plainly, so a 128 kbps is not
taken for a mix reference six months later.

The page **only polls while it is open**, through `src/poll.ts`: the work is on the server, and a
tab asking continuously for a closed screen would pay a round trip for nothing.

## When it cannot run

The YouTube fallback's button is greyed, with the reason, when the server says it has no `yt-dlp`
(`GET /api/hunt` → `youtube`), rather than failing on click. And while the slskd settings are
incomplete the page opens all the same and **says what is missing**, with a link to the settings
([settings.md](settings.md)), instead of failing on every keystroke: a new instance is unconfigured.
