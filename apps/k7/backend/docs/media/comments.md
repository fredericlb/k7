# Comments on a share — the one thing a share is not read-only about

A share is read-only: the visitor listens, mutes and solos for themselves, looks, and changes nothing.
A **comment** is the exception, and it is not an exception to that rule — it changes nothing *of
the project*. It is a block of text beside the share, with an optional **timecode** saying where
the playhead was when it was written.

[shares.md](shares.md) is the page for the share, its two identifiers and its revocation. This
one is only about what gets written back.

## Why this one thing is a database

Everything else this service stores is a file: the médiathèque IS its volume, the preferences are
one JSON per person, the shares' register is another. That works because **every one of those has
a single writer** — its owner, on a session only they hold.

A comment does not. The link is what a share is made of: it goes to a band, a label, a room, and
those people write at the same time from addresses this service has never seen. A read-modify-write
over `comments.json` loses one of two comments that land in the same tick, and loses it *silently*
— the writer gets a 200 and the text is gone. That is the failure a share must not have: a
person who left a note and cannot find it will not write a second one.

SQLite is `node:sqlite` — **no dependency at all**, and no native build in an image that has none
to spare. It is still behind `--experimental-sqlite` on Node 22, this image's runtime, so
`apps/k7/docker/Dockerfile` sets it as the process's own `NODE_OPTIONS`, and `apps/k7/backend/scripts/with-env.mjs` in dev and test; the flag is accepted
as a no-op from Node 24, so the day the image moves nothing here has to.

The file is `<media library>/.shares/comments.db`, inside the dot-folder `writablePath` already
refuses and `revision.ts` already does not walk — the same free invisibility the blobs get. WAL,
because the reader is the public route and the writer is the author's, and neither may block the
other.

## The public router has one write verb

What bounds it has to be as short to read as *there is no write here at all* would be, because
this is the one unauthenticated surface of the service. Three walls, and all three are in `commentGate.ts` or one line from it:

| what | bound | why that one |
|---|---|---|
| the text | 4000 characters | a comment, not a payload |
| the name | 80 characters | a label on a row |
| the body of the request | 64 kb, its own `express.json` | the service's global parser takes 8 MB, and nothing here is a file |
| per address | 10 per 10 minutes, in memory | a courtesy limit: a restart forgives, which is the right failure |
| per share | 500 | the ceiling that is **not** disk — a share never expires |

The window is keyed on the **address and not on the link**, because a link is shared: throttling by
key would make one person's burst silence the whole room.

`commentGate.ts` decides and the route obeys. It is pure, so the walls are testable without a
socket, which is what keeps them from being reasoned about instead of checked.

## The three states, and who moves them

`active` is where every comment lands. Its author — the person who published the share — moves it
to `resolved` or `ignored`, from k7's own home page, and back. **Nothing deletes.** Two ways out
of the active list is enough to sort feedback, and a delete verb on a public write surface is a
second thing to get the ownership check right about.

The state is **visible to the visitor**, as a chip on the row and with no tabs: whoever wrote a
comment is owed the answer to "was this looked at". They cannot move it.

The counts are computed **on the way out**, in `GET /api/shares`, and never written onto the
share's row: a stored count is a count that goes stale, and the register is a file whose writes
throw for a reason that has nothing to do with comments.

## What happens on revocation

The bytes go and the link answers 404 to everyone — comments included, since the public routes all
refuse a share that is not there. **The rows stay**, and the author still reads them from the
row that survives dated. The bytes were the cost of the share; the feedback is what it was for, and
it weighs nothing.
