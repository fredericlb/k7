# The media library

The media library is where your audio lives outside of any project: the songs you mix and
rehearse against, your sample packs, the raw captures your rehearsals produce, and the set lists
that name songs in order. It is part of k7 and opens at `/media`, inside the same home frame as
your projects.

Everything in it is a plain folder of files on the server. There is no database to fall out of
step with: what is on disk is what the library shows.

## Opening it

From the home page sidebar, the **Media library** group lists its sections. Each one opens at its
own address:

| Section | Address | What it holds |
|---|---|---|
| Songs | `/media/songs` | Finished recordings, one folder per song, filed by artist, album and title |
| Samples | `/media/samples` | Audio and video samples, grouped in packs |
| Recordings | `/media/recordings` | Raw captures, one folder per day |
| Playlists | `/media/playlists` | Set lists: files naming songs in order |
| Find songs | `/media/find` | Search for a song by artist and title and have it downloaded and filed |

The sidebar shows a count beside every section except Find songs. `/media` on its own opens
Songs.

If your instance answers on a `play.` address, any page there sends you to the same page under
`/media`.

## The screen

**Songs** is a table the width of the screen: what you are practising first, then your favorites,
then every other song, each group by artist and title. An album holding more than one song is a
single row; click it to unfold its songs, in the album's order. Click a song to open its screen,
which takes the whole width too; its **Back** button returns to the table. Each row's **⋮** holds its
menu (see [Songs and samples](./71-songs-and-samples.md)).

Samples and Recordings share another layout:

- **The tree**, on the left: the section's folders and files. Rows are sorted alphabetically at
  every level. Right-click a row for its menu.
- **The contents**, in the middle: the section's entries with their pack, their kind and their size.

On a narrow screen their tree becomes a drawer: tap the tree button at the bottom left to open it,
tap outside it to close it.

An entry marked **not catalogued** is a song folder that holds audio but no `song.yaml` sidecar:
it was put there by hand rather than added through k7. It still plays; the first edit of its
sidecar files it properly.

When the library is mounted but holds nothing yet, the page says "The media library is empty for
now." That is not an error.

Playlists and Find songs have screens of their own: see
[Playlists, the player and the queue](./72-playlists-and-playback.md) and
[Finding songs](./73-find-songs.md).

## Where the sound comes out

The speaker button in the sidebar picks the **playback destination** for everything the media
library plays:

| Destination | What happens |
|---|---|
| This machine | Your browser downloads the file and plays it. Needs nothing else. This is the default. |
| The media library | The server that holds the files plays them on its own audio outputs. |
| The engine | Your machine's k7 engine plays the song on its outputs. The song is first copied to that machine. |

The choice is saved on your account. When you choose **The engine** and no engine is answering,
playback falls back to **This machine**; the button and the song screen say so with "(fallback)".

## On your computer or phone, paired with a server

When k7 on your computer (the tray) or the Android app is paired with a server, the media library on that device is
its own local library, and it also shows what the server holds:

- An entry the server has and this machine does not is drawn among the others with a cloud icon,
  greyed out. Click its download button (or, for an album, choose **Download the N missing songs**
  in its **⋮**) to bring it down.
- A folder that holds only server entries shows a small cloud beside its name.
- In the contents list, an icon says whether each entry is "Synced with" the server or "On this
  machine only".

The server is checked again every 30 seconds for what other machines uploaded. On the server
itself, and on a device that is not paired, none of this is drawn.

## Settings that belong to the media library

The home **Settings** page carries two cards for it:

- **Engines** lists every engine registered with this instance, the same ones k7 offers, with
  their latency and whether one is in use and by whom. It is read-only: an engine is connected
  from its own machine. **Refresh** looks again. When none is registered, the card tells you to add
  this instance's address to `registryUrls` in the command-line engine's config file.
- **Find songs** (the slskd card) holds the Soulseek access the song search uses. Only an
  administrator of the instance sees this card. See [Finding songs](./73-find-songs.md).

## Related pages

- [Songs and samples](./71-songs-and-samples.md)
- [Playlists, the player and the queue](./72-playlists-and-playback.md)
- [Finding songs](./73-find-songs.md)
- The rehearsal recorder, whose sessions land in the Recordings section:
  [The rehearsal recorder](./74-rehearsal-recorder.md)
