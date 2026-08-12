# Auditioning a variant

A song's chain variant can be **heard**: a play button on the `OUT` node of the drawing
sends the song through the chain and starts the transport.

## Why the button is on the output

Because that is where the sound you want to judge exists. The input node carries the file as it
was; every treatment the chain declares happens between there and the sink, so a button on the
input would offer to play the thing you already have. Auditioning means listening *after*.

`SinkPlay` in `@studio/ui-chains-react` is therefore an **opt-in prop on the sink**, and it is
absent by default. l8 has a transport of its own and m9 has a deck; a second play button
inside their graphs would be a second way to start audio, with no obvious precedence. The
médiathèque has neither, which is the whole reason it needs one.

## Two disks, and the trap between them

This browser is talking to the **hosted** médiathèque. The moteur opens **paths on its own
machine** and cannot fetch a URL. So what actually plays is the copy in the chosen machine's
médiathèque cache, reached through that machine's file service — the same route m9 takes, and
its `docs/plumbing.md` walks it end to end.

Concretely, the two halves come from different places on purpose:

| what | from where | why |
|---|---|---|
| the audio | the engine machine's cache (`/mediatek` → `root`, plus the entry's path and `meta.master`) | the engine opens it as a file |
| each step's `plugin:` block | the hosted library (`nodes/<name>.yaml`) | it is DATA, and it is the same data on either disk |

Reading the plugin blocks from the hosted side is not a shortcut — it is the correct source.
A module's `plugin: {type, name}` is what the engine should load, not where anything sits, so
fetching it from the machine's cache would add a round trip to learn the same two strings.

## What the button says when it cannot play

It stays disabled and its tooltip says which of the three reasons applies:

- **no engine** — nothing was chosen, or nothing answered the probe;
- **that machine has no médiathèque cache** — the file service answered but holds no library;
- **this song has no audio file** — a folder with a sidecar and no master, which is a real
  state (a mirror that stopped halfway, a folder made by hand) and not a failure to hide.

The distinction matters because the fixes are three different actions, and a button that is
merely grey invites you to guess.

## The document

`chainPreviewDoc` is one track: the master as its single clip, the chain's steps as plugins on
it, addressed `chain-preview:<module>` — the same identity the drawn node uses. That identity is
the point. A graph showing a filter the engine never loaded would be a picture of a signal path
that does not exist, and a decorative graph is worse than no graph.

The steps come from `chainSteps()`, which parses the same text the drawing parses, so the chain
you see and the chain you hear cannot drift apart. `@in` and `@out` are dropped: they are the
ends, not treatments.

It lives in `@studio/song`'s `chainsGraph.ts` now, beside the derivation itself, and
`chainGraph.ts` re-exports it. It moved when l8 grew `track process` / `clip process`, which
bounce one of these templates from Node onto a track or a clip
(`packages/commands/docs/processChain.md`): a second reader of the same files had to read them
the same way, and the ends had to keep one spelling.

`recordDir` stays empty — a preview plays and never records, and a made-up directory is one the
engine would eventually try to write into.

## One session, one sound

The preview goes to `SESSIONS.st0`, per service **and** per person — the same session the
module editor auditions through. Playing a variant therefore replaces whatever that session
held, the one-module preview included. That is deliberate: auditioning two things at once on one
engine is not something to arrange, it is something to forbid.

Leaving the pane stops the transport. Without that, the sound outlives the screen that started
it and there is no longer anything on screen to stop it with.

# Process — bouncing the variants

The same pane carries a **Process** button: one offline render per chain variant, written back
beside the master as `<variante>.mp3`.

## Offline, not the transport

`--render` opens no audio device — that is the whole reason it cannot collide with a live engine
(see `packages/file-service/docs/render.md`). So Process runs happily while you are auditioning
something, and it does not take the interface away from whoever else is on that machine.

It goes through `POST /render` on the engine machine's file service, one request per variant,
**sequentially**. Each bounce spawns an engine on that machine; firing off a library's worth at
once would have them fight for the same CPU and the same plugin scan, which is slower in
wall-clock than doing them one after another.

## `.mp3` is a request, not a promise

The engine writes **wav** and only wav. The mp3 is an ffmpeg transcode on that machine, and
ffmpeg is not a dependency of this repo — so it is best-effort, exactly as
`@studio/commands/render` has always treated formats: a missing ffmpeg costs the FORMAT, never
the render.

The route therefore answers with the content type of what it **actually wrote**, and the
médiathèque files the result under the extension it got back. A wav saved as `.mp3` would be a
file that lies about itself — the scan would list it and nothing would play it — and that is a
worse outcome than a `.wav` sitting where you expected an `.mp3`.

## One variant's failure is its own

Each render is caught separately and the loop continues. A chain naming a plugin that machine
has never scanned must not cost the other three their renders; the pane lists what was written
and, per variant, what went wrong.

## Only chain variants

A FILE variant is already a file. Bouncing it would write a copy of something sitting right
there, so Process ignores it and the button counts only the chains.

## Where it lands

In the song's own folder, beside the master — variants are siblings, and that is what
`(nom variante).mp3` says. `songs/` is the one family nobody edits by hand (its *shape* comes
from the three tags, see `packages/mediatek/docs/songs.md`), and this does not change that: it
adds files inside a folder the library already derived, it does not invent a path.
