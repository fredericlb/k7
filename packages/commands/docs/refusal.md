# Saying NO — `h.refuse()`

A handler has one output channel and used to say everything through it. `event consolidate` on
a two-lane rectangle wrote a line; so did `event consolidate` on a good one. Both arrived as the
same grey text under the command bar, and the app went on as if the edit had landed — because
nothing in the wire said otherwise.

So `CommandHost` has two verbs:

| verb | what it means |
|---|---|
| `log(lines)` | this is what I DID |
| `refuse(lines)` | this is why I did NOTHING |

Same lines, same order, one flag. `refuse` does not throw and does not return: a handler that
refuses says so and then `return`s, exactly as it did before.

## How far the flag travels

`runWebCommand` returns a `CommandOutput` — a `string[]` carrying an optional `refused`. The
`/command` route puts it on the JSON beside the output, `@studio/project-shell`'s client hands
it back with the lines, and l8 paints the status line and the log rows **amber** instead of grey.
The CLI needs nothing: a refusal reads the same on a terminal either way.

One line, one boolean, nothing structured. A refusal is not an error object — it has no code, no
type and nothing to branch on. What a caller may do with it is *show* it differently, and that is
the whole contract.

## Which lines are refusals

The rule is mechanical, and it is about what the handler DOES rather than how the line reads:

- it **returns instead of working** — a usage line, an unreadable timecode, a track that is not
  there, an event that is not at that position, a rectangle spanning two lanes;
- it is the handler's own `catch`, where the write threw and the project is unchanged;
- it declines a no-op it was asked for — `events move` by a delta of zero.

And what stays on `log`: the report at the end of a successful handler, including the multi-line
ones that name what was written and what was left behind. Those are followed by `h.reload()`,
which is the tell.

`no event on '<track>' at <tc>` is a refusal, not a finding. The verb was asked to cut something
and there was nothing there; the caller learns that its address was wrong.

## It is the whole catalogue now

Every family — `track`, `clip`, `event`, `sequence`, `node`, `module`, `graph`, `project`,
`system`, `transport` — plus the dispatcher itself: an unknown verb, a missing handler and a line
`validateArgs` rejects are refusals, since none of them ever reached a handler.

Two lines deliberately stayed on `log`, and both are the same shape — a bare call whose ANSWER is
a listing:

- `sequence list` on a project with none says so;
- `node alternative select <node>` with no name lists them, the running one in brackets.

Neither was asked to change anything, so neither declined.

Two calls were SPLIT rather than classified, because one ternary carried both channels:
`track take keep` on a track with no takes, and `module new` on a module that is already there.
Both used to report a zero as though it were a result.

## The rule is pinned in the source

`refusal.test.ts` reads `commands.ts` and fails on two shapes:

- an `h.log([…])` whose next line `return`s — that is a handler declining, and the one
  legitimate exception (the alternatives listing) is named in the test with its reason;
- an `h.log([…])` carrying `(e as Error).message` — a handler's own `catch`, where the write
  threw and the project is unchanged.

A source check rather than a behaviour test, because the failure it guards is INVISIBLE: a
refusal sent through `log` runs, returns, and reads like a success. Nothing at runtime would have
noticed, which is exactly how sixty-five of them accumulated.
