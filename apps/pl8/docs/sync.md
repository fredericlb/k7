# Synchroniser une playlist — the button, and who does what

```
POST /api/sync   { playlist, engineId, target }   →   { job, skipped }
GET  /api/sync/targets?engineId=…                 →   { targets: [{name, uri, scheme}] }
GET  /api/sync/:id?engineId=…                     →   the job, verbatim
```

The target itself, its two schemes and what the copy does are
[packages/file-service/docs/playlistSync.md](../../../packages/file-service/docs/playlistSync.md).
This page is the button and this service's half.

## The same division as a stem cut

pl8 holds the catalogue, so pl8 resolves the set list; the machine holds the target, so the machine
writes. Neither does the other's job, and that is what keeps the two from having to agree about
anything but a list of tracks.

| | here | the machine |
|---|---|---|
| the playlist file, and the songs it names | ✓ | — |
| which file is a song's master | ✓ | — |
| the target's URI and its password | — | ✓ |
| the bytes, and where they land | — | ✓ |

The consequence worth stating out loud: **no FTP credential ever reaches this service.** A run names
a target; the machine looks the URI up in its own preferences. pl8 mints everybody's session and
holds the one deploy key, and `docs/projects.md` is the page about not adding to that pile.

The bytes do not pass through here either. The machine fetches each track from `/api/mediatek/file`
on its own médiathèque link — the same route every other reader uses — so a sync is not one long
request held open by this service.

## Which engine

Named by the caller (`engineId`), as a stem cut is, and for the same reason: it is the engine that
browser is already on, and this service has no opinion about which machine is yours. The registry
turns the id into the addresses the engine advertised and each is tried in turn, loopback first.

A registry **miss** is a 409 and not a 404 — the engine was there when the browser picked it, and the
remedy is to bring the machine back up. A **refusal** from the machine is forwarded verbatim rather
than retried at the next address: "this machine has no target named X" is a sentence with a remedy in
it, and retrying would turn it into "no engine responded".

## A line naming no song is skipped, not fatal

`tracksOf` drops a line the volume has no song for and returns it under `skipped`, which rides along
with the job so the screen can name it. A set list of twelve with one typo copies eleven songs.

Nothing resolvable at all is a **400** with the lines named: there is no work to start, and the
remedy is in the playlist rather than on the machine.

A catalogued folder with no audio is skipped the same way — the scan allows one, so a playlist can
name it.

## Variants are ignored

A line naming `instrumental` copies the **original**. One file per song on the target, for the reason
the file-service page gives; here it matters because this is the service that knows what a variant
even is, and the flattening happens on this side rather than being a rule the machine has to be told.

## The button

On the playlist header, not in the row toolbar: it acts on the whole set list, while ↑ ↓ × act on a
line. The dropdown lists the chosen machine's targets, **re-read every time it opens** — a stick is
plugged in and a target added while this screen is up.

Three states are told apart, because the remedies are in three different places:

| what shows | what it means |
|---|---|
| the button is dark | no engine is chosen — pick one first |
| « cette machine n'a aucune cible » | the machine answered, and has none declared |
| a red line | the machine refused, or could not be reached |

The second has its remedy on the machine and not here: targets are declared in the tray's settings
window, Sync tab ([engine/st0-tray/docs/tray.md](../../../engine/st0-tray/docs/tray.md)). This screen
deliberately offers no way to add one — it would mean typing an FTP password into a hosted page, and
the whole arrangement is built so that credential never leaves the machine.

While a run goes, a bar counts **tracks**, and the phase is the song being copied. When it finishes
the line reads what was copied, what was already there, and where the m3u went when there was a
`playlists/` folder to put one in. What did not go is listed underneath — the skipped lines from
here, and the failed tracks from the machine, which are different failures and say so.

Closing the screen stops the polling, not the copy: the run belongs to the machine and finishes on
its own, the same split the stems bar makes.
