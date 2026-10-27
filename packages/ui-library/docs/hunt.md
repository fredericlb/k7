# The automatic download, in the add-song popin

`src/HuntProgress.tsx` follows ONE automatic download, inside **Add a song** (`src/AddSong.tsx`,
[library.md](library.md), "Adding a song"): what is asked of slskd, how a peer is chosen and how the
bytes come back are the server's, in
[apps/k7/backend/docs/media/hunt.md](../../../apps/k7/backend/docs/media/hunt.md). This page is
only why the screen is the shape it is.

## One of three ways, not a page of its own

A song enters the library one way, as one enters the songbook: its artist and title first, then where
its audio comes from — a file, the automatic download, or none. The download is the second of those
three and has no section, no address and no history screen. Two pages for one act made the user
choose between them before knowing which would work, and the history page grew into a queue of
titles where the act is one song.

The popin sends the hunt the names the user TYPED, as tags (`POST /api/hunt {query, tags}`), so the
song is filed under them rather than under whatever a peer called the file, and lands in the very
folder an upload or a song without audio of the same names would.

## Closing the popin is not cancelling

The hunt lives on the server, and lasts minutes. Closing the popin stops only the watching, and says
so; the song appears in the catalogue once filed, through the library's own poll. **Stop** is the
cancel, offered only while it runs. A failed one offers to **choose another way** — upload a file
instead, or keep the song without audio — beside the YouTube fallback.

## What it says

While downloading, **who** is sending and which peer number; on failure, **why** — the whole chain of
causes the server joined; once filed, **where**, and the format obtained, said plainly, so a 128 kbps
is not taken for a mix reference six months later.

It **only polls while the popin is open**, through `src/poll.ts`, and asks for the list and keeps
its own row: the server has no route for one hunt.

## When it cannot run

The YouTube fallback's button is greyed, with the reason, when the server says it has no `yt-dlp`
(`GET /api/hunt` → `youtube`). While the slskd settings are incomplete, the download is the one way
greyed out, and the popin **says what is missing**, with a link to the settings
([settings.md](settings.md)) on the machine that holds them: a new instance is unconfigured.
