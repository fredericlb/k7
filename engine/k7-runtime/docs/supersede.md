# A queued job a newer message made pointless is skipped (`server/Supersede.h`)

Every message about a project becomes a job on the message thread, run in the order it arrived. A
first `applyFull` is seconds long, and a client keeps talking meanwhile: the file service re-sends
the document on every save, a dragged knob sends a `set-plugin-param` per frame. Run one by one,
each stale document is diffed and applied after the slow one, and each stale parameter write walks
the plugin's whole parameter list — seconds more of a deaf message thread, for states nobody wants
any more.

So three verbs are **superseded** rather than queued blindly. A job is never reordered: it is
either run where it arrived or skipped.

## The rule

A queued job is skipped when, before it runs, a newer message of the same session makes it
pointless, and no **fence** arrived between the two.

| verb | is superseded by |
|---|---|
| `project` | a later `project` |
| `tracks` | a later `project`, or a later `tracks` naming exactly the same set of track ids |
| `set-plugin-param` | a later `set-plugin-param` on the same plugin id and parameter name |

A **fence** is any other message naming that session — `transport`, `flush`, `preview`, `arm`,
`set-preset`, `get-plugin-params`, everything — except the read-only probes Serve.cpp already lists
(`io-levels`, `instrument-status`, …), which change nothing and are polled. Sessions never fence
each other: each has its own edit.

## Why these lines and not others

**A fence keeps every other verb's order intact.** `project`, `play`, `project` runs all three:
the play happens on the first document, as sent. Without the fence the first document would be
skipped and the play would start the previous song. The file service's dry run is exactly such a
sequence — a silenced document, play, stop, the real document — and must run as written.

**A `tracks` delta is not a whole state.** It replaces the tracks it names inside the document the
session holds, so one naming `drums` says nothing about `bass`: only the same set overtakes it. A
`project` replaces everything, so it overtakes any delta queued before it; a delta never overtakes
a project, whose other tracks it would lose.

**Documents and parameter writes do not fence each other.** They interleave by nature — a knob
dragged while saves go out — and fencing would undo the whole point. It is safe because a live
parameter write is ephemeral by contract (`set-plugin-param` does not persist; the client writes the
value on release): its effect already lasts only until the document says otherwise or the instance
is rebuilt. Skipping a document between two writes can at worst lose a write aimed at a plugin that
document would have created — the same loss a rebuild inflicts, and the release's save restores it.
Two writes to one parameter leave the last value whatever lies between them.

**A skipped `project` answers nothing.** No `busy`, no `applied`: the document that overtook it
answers. A client that sends one document and waits for its `applied` before the next is never
superseded, so it sees no difference.

## The one lock

The ledger takes the ticket and posts the job under one mutex. IXWebSocket runs each socket on its
own thread, and a session is often driven from two sockets (the file service sends documents, the
browser sends knobs and transport): if the ticket were taken outside the post, two threads could
queue their jobs in the opposite order from the one the ledger saw, and skip the wrong one. A fence
is marked before its handler posts, so the race can only make it fence one job too many — less
coalescing, never a wrong skip.

The message thread reads a ticket as one atomic flag, and never takes that mutex.
