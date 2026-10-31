# A moment consolidated on a server, its recording kept on the machine

A **consolidated** moment is one with a clip of its own: its span cut out of its recording, brought
to the clip loudness, and filed in the médiathèque as a `moment-…` entry ([audio.md](audio.md)).
A server consolidates its own moments as soon as they are saved. A LOCAL instance (a desktop, a
phone: `K7_INSTANCE=local`) consolidates none: it keeps its recordings and its moments, and a
consolidated moment is made on a server, one at a time and only when someone asks for it.

## Why a local instance cuts no clip

A consolidated moment exists to be heard by people who were not at the rehearsal, which is what a
server is for. A clip on a laptop is a second copy that nobody else can play, and a cut is a full
decode and encode, which a phone would pay for on battery. So on a local instance `addMoment` cuts
nothing, a moved span drops a clip cut there before instead of cutting a new one, and
`POST /moments/:id/validate` answers 409 in words (`../src/store/moments.ts`). Where a local instance
saves its recordings is unchanged: they stay on the machine and nothing uploads them on its own.

## The active server takes it

An account on a local instance uses ONE server at a time, its active link
(`../../file-hub/docs/syncRelay.md`), and a moment is consolidated there: `GET
/api/sync/moments-share/servers` names that server and whether it answers a short ping (a few seconds
at most, remembered briefly, `apps/k7/backend/src/media/serverSongs/reach.ts`), and `POST
/api/sync/moments-share/:id/consolidate` (`{ link }`) sends through its device token
(`../src/momentConsolidate.ts`). The `link` must name the active link: a dialog opened before a switch
sends nothing to a server the account no longer uses. The screens are
`../../ui-rehearsal/docs/recordings.md`.

## What goes up: the moment's audio, and the server cuts

The server cuts the clip exactly as it cuts one of its own (`cutClip`), from the audio the machine
sends beside the moment's span, text, tags, recording start, envelope and markers:

- **A span of a WAV, when the recording is one.** PCM samples are cut by bytes under a header of
  their own, with no decode (`../src/wavSlice.ts`), widened to whole frames. The machine says where
  the slice starts (`sourceStartSec`), and the server cuts the span at that offset.
- **The whole recording otherwise.** A WebM, Ogg or MP3 cannot be cut without decoding it, which
  is the work a local instance does not do. The upload may be long; it is given an hour.
- **A clip cut on the machine before**, when its recording is gone: it is all there is, and it goes
  as the clip, uncut again.

The recording, its session if one saved it, and its other moments stay on the machine. Nothing of
what was sent is kept on the server but the clip.

## What the machine remembers

The local row keeps a list of where the moment was consolidated (`Consolidations`: the link's id,
the server's origin, the account, when), so the moment's row and page say "consolidated on host ·
account", link to the server's page for it (`/rehearsal/moments/<id>`, the id being the machine's),
and do not offer the same server again. The list is the machine's memory of a send: a copy deleted
on the server still reads as there until it is sent again through the moment page.

On the server the moment has no recording (`RecordingPath` is empty). It keeps its recording's
start (`RecordedAt`, in `../src/schema.ts`), because a recording has no name and the date is how a
moment is labelled and placed ([moments.md](moments.md)). It reads like a moment whose recording
was deleted, which is what it is from the server's side. The machine sends that start as
`recordedAt`, and again as `sessionCreatedAt`, since a server older than the field requires that
one; a server takes either.

## Whose moment it is

The server files the moment under the PERSON who paired the link, the OIDC subject the device
token names, so it appears in that person's moments on the server. A token from before tokens
named a person cannot send a moment, and says so: the machine has to pair again. On the server,
a moment id that belongs to someone else is refused, never overwritten: two accounts on one server
cannot both hold the same machine's moment. The id comes from the machine and becomes a row id and
a cache file's name, so one that is not a plain segment is refused (400), as is a `moment` field
that is not JSON ([serving.md](serving.md)).

## Sending again replaces

The copy keeps the machine's moment id, which is how the machine tells which of its moments the
active server holds (`GET /api/sync/moments-share`, the icons of the moments list). Sending a moment
the server already holds REPLACES the server's copy: its clip, its text and its markers. This is the
one way an edit made on the machine reaches the server: a moment is a snapshot, never a replica, so
there is no live sync of it.

## Read-only on the server

The copy records the machine it came from (`SharedFrom`, the name the device was paired under),
and `../src/routes/moments.ts` refuses every change to it: a marker added, edited or removed. An
edit made on the server would be lost silently at the next send, so the server takes none. The
moment's page says where to edit it instead. It can still be DELETED there: that takes nothing from
the machine.
