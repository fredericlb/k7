# Finding songs

**Find songs** (`/media/find`, its entry in the sidebar, or **Add a song** above the Songs table) gets a
song you do not have yet: you type an artist and a title, and the server identifies the song,
searches the Soulseek network for it, downloads it from a peer and files it in **Songs** by itself.

## Which server searches

The search runs on the server whose library you are browsing, and the song lands there. On a
computer running the tray, that is the server chosen in the sidebar's server picker: **This
computer**, or the server you are paired with. If that server cannot be reached, or has no slskd
set up, the Find songs page says so and searches nothing.

## Before the first search

The search needs an [slskd](https://github.com/slskd/slskd) daemon (a Soulseek client with an
HTTP API) and SFTP access to the machine slskd downloads onto, to bring the file back. An
instance that has not been set up says so on the Find songs page, with a **Settings** button.

These settings are an administrator's: only a member of the instance's admin groups sees the card,
and anyone else is refused. If the search says it is not set up, ask an administrator.

On the **Server** page (`/settings/server`, in the user menu of the server's admins), the slskd card has these fields:

| Field | What to enter |
|---|---|
| Address | slskd's HTTP address |
| API key | slskd's API key |
| SFTP host, Port, User | The machine slskd downloads onto |
| Folder slskd downloads into | That folder, as seen from slskd's machine |
| SSH private key | The key's contents, not a path |
| Key passphrase | If the key has one |
| Password, if no key | For password logins |

Secrets are stored sealed on the server and never sent back to the browser: a saved one shows
"saved — type to replace". **Forget** clears one. **Save** stores the card; **Test the connection**
checks it. These settings belong to the whole instance: everyone's searches use them.

## Searching

1. Type artist and title in the field, for example `nirvana lithium`.
2. Click **Search**.

Each search becomes a row in the history under the field:

| Colour | State | What the row says |
|---|---|---|
| Blue | Searching | "searching for the song…" |
| Blue | Downloading | "from <peer>", and "peer #N tried" when the search moved to another peer |
| Green | Done | Where the song was filed |
| Red | Failed | Why |

A filed row also shows the album, the year and the format obtained (for example `FLAC` or
`MP3 320 kbps`), so you know whether it is good enough to mix against.

How a search proceeds:

- The song is first identified on MusicBrainz (Deezer is asked only when MusicBrainz cannot be
  reached). The identified artist, title and album decide where it is filed.
- The network is searched for about 12 seconds, and the answers are ranked.
- A peer has one minute to start sending; otherwise the next one is tried. After ten peers the
  search fails.
- A transfer that started may take up to 30 minutes.

Limits: at most 4 searches running at once per person, and a query of at most 200 characters.
The history keeps your last 100 searches; it is yours alone.

## When Soulseek has nothing

A failed row that failed because the network had nothing offers **Get from YouTube**. It
downloads compressed audio with `yt-dlp` and files it the same way (its sidecar says
`source: youtube`). It is never done automatically. When `yt-dlp` is not installed on the server,
the button is greyed out and says so.

## Cleaning up the history

The button at the end of a row is **Abandon this search** while it runs (it stops it) and
**Remove from the history** once it has ended. Removing a row does not delete a filed song.

## Related pages

- [Songs and samples](./71-songs-and-samples.md)
