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

## Identified and checked before anything downloads

The download first asks what the names WOULD hunt (`GET /api/hunt/identify`, MusicBrainz then
Deezer), because the best match for the words typed is not always the song meant. The answer is
judged by the songbook's own rule, `sameSong` (`@studio/mediatek/songMatch`, through
`src/identifySong.ts`): artist and title each a typo away at most.

- **The same song**: the hunt starts at once, searching THAT recording — its album included,
  which is the first search slskd is asked.
- **Another song**: nothing starts. The popin names what was identified (artist, title, album,
  year) and offers **Download it anyway** — the user knows the song better than a scorer —,
  **Choose another way**, or **Cancel**. Refusing outright, as the songbook does, would leave no
  way to get a recording MusicBrainz names differently; downloading silently is the wrong file.
- **Nothing identified**: **Search anyway** hunts the names as typed, said to be unchecked. An
  obscure song is not in MusicBrainz, and that is no reason to forbid its download.

## The typed names decide the folder

The hunt is sent the identified tags to SEARCH with and the typed names to FILE under
(`POST /api/hunt {query, tags, fileAs}`), with the album unknown: the song lands in
`songs/<artist>/Album inconnu/<title>`, the very folder an upload or a song without audio of the
same names takes, and where the songbook's song of those names is looked for. Filing under the
identified album would put one song in two places depending on how its audio came, and the
"already filed" check, which reads that folder, would miss the song added without audio.

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

The popin words that notice itself (`src/huntAvailability.ts`): the server answers which halves are
blank as ids (`missing`: `slskd`, `sftp`) and the host's labels name them, so the sentence is in
the reader's language and names what the settings page shows rather than the server's internals.
The server's own `reason` is read only when it gave no ids, the request itself having failed.
