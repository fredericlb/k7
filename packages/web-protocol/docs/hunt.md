# The search history's contract

`hunt.ts` is one automatic download of the médiathèque's add-song popin, as the backend writes it and the
screen draws it. It is stated here rather than in either half because both read the same rows;
what the backend *does* with them is `apps/k7/backend/docs/media/hunt.md`.

## `exhausted` is not "it failed"

`HuntRecord.exhausted` is true in three cases only: nobody shared the song in a usable format, no
peer started sending, or there were none left to try. That is what tells **the network does not
have it** apart from every other failure — missing configuration, a service restart, a cancelled
search, a file missing over SFTP — which say nothing about availability and call for another fix.

`canFallBackToYoutube` lives in the contract rather than on either side because both ends must
share one definition: the screen decides to show the button, the route decides to accept the
click, and the two answers must agree. A visible button the route would refuse is a dead end.

A red row is NOT enough for that button. A restarted service, a cancelled search, a downloaded
file that could not be fetched over SFTP: in those three cases Soulseek said nothing about
availability, and going to YouTube would answer a question nobody asked — worse, in the SFTP case,
it would hide a configuration fault behind a lower-quality file.

`HuntList.youtube` is a second gate on the same button: yt-dlp is a binary in the image rather
than a setting, so without it a failed row would otherwise offer a button that cannot work. And
`configured` rides along so the screen can draw its own absence — a button that opened a field and
then failed on every query would be worse than one that says which variables are missing.

## Why a row keeps more than it shows

- **`query`** is kept verbatim: it is the row's title until MusicBrainz answers.
- **`format`/`bitrate`** record what the transfer actually delivered, because a song filed at 128 that SAYS so
  will not be mistaken for a mixing reference six months later.
- **`peer`/`switches`** are both shown, because "queued behind forty" and "nobody will send it"
  are different waits and want different patience.
- **`via`** is absent for the ordinary path, Soulseek through slskd; `youtube` is the fallback
  somebody asked for after that came back empty-handed.
