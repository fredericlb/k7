# Warming the playlist

A platter's tempo and grid come from a `{fichier}.cache` sidecar the engine writes on first
read. On this machine, **4 tracks out of 279** have one.

Without it, dropping a record triggers the analysis **at that moment**: several seconds during
which the fader shows `—` and SYNC is dark. **Normal at a desk, unacceptable on stage** — the
moment you drop a record is exactly the moment you have no five seconds to spare. So the desk
warms the set list instead: the playlist a surface names is already exactly the tracks that
matter ([bpm.md](bpm.md)).

## What it does

As soon as the surface has resolved its list, the desk analyses the tracks **one at a time**, in
the background, in playlist order. An analysed track posts its tempo and lights SYNC **at once**.

The call is **exactly the one a load makes** — `service.envelope`, the same route. Hence two
properties that came free:

- a warmed track costs a load nothing;
- a track loaded before its turn costs the warm-up nothing.

The route is a cache on both sides, so **nothing is skipped here**: asking IS the way to know,
and asking is cheap once it is warm.

## One at a time, and that is the point

The analysis belongs to the **engine**. A whole list fired off in parallel would contend with the
disc someone is dropping right now — it would make worse the exact second it exists to make
better. The test pins it by counting calls **in flight**: never more than one.

## What stops it

`alive()` is consulted **between two tracks**, never during one. Changing playlist or closing the
desk therefore stops the march at the next track, without interrupting the one the engine is
reading — half a job done leaves nothing broken, just one sidecar fewer.

An unreadable file is **counted and stepped over**: a track the playlist names but the machine
does not have must not cost the twenty-nine after it.

## What it draws

One line, in the bottom bar, and **only while there is something left to do**:

```
♪ 12/24
```

Nothing before, nothing after. A gauge sitting at `24/24` all evening would be noise; what
matters is "is it still working". The tooltip gives the unreadable count when there is one,
because that is the only thing here anyone can act on.

## What it does not do

- **It does not analyse the médiathèque**, only what the playlist names. The volume's 279 tracks
  are not the subject: twelve are.
- **It does not separate stems** — that is `playlist stems`, minutes per track, and the command
  you run the night before ([stems.md](stems.md)).
- **It does not fix a wrong grid.** Analysing earlier does not make the analysis righter;
  [grid.md](grid.md) is what handles that.
