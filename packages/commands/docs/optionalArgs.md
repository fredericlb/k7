# `optional: true` — args a line runs without

An argument in `commands.yaml` may carry `optional: true`. It means exactly one thing: **the
line is complete without it.**

```yaml
- command: "event move"
  args:
    [
      { name: track, complete: tracks },
      { name: timecode, type: timecode },
      { name: newTimecode, type: timecode },
      { name: toTrack, complete: tracks, optional: true },
    ]
```

## Why it is a field and not prose

A `hint:` can say it — *"optional — another track, of the same type as this one"* — and that
tells a person reading the catalogue and tells no program anything. It costs nothing while the
only consumer is a CLI, where a handler reads `argv` and decides for itself.

It costs the moment a **form** consumes the same catalogue. k7's command bar asks for one
param at a time and dispatches on the last one, so "how many are there" is the question that
decides when the line can run — and `args.length` answers four for a command three of whose
params you actually have to give, so the bar can never dispatch a bare `event move`: it waits
for a param the command does not need. `requiredCount` in k7's `commandFill.ts` is the whole
consumer, and it is three lines.

## TRAILING only

Only a trailing run of optional params is dropped. `a b? c` requires all three.

This is not a limitation to be lifted later — it is what positional arguments mean. Skipping
`b` would shift `c` into `b`'s place, and the handler would receive an answer for a param
nobody gave. A param that is genuinely optional in the middle of a line needs a name at the
call site (a flag), which this vocabulary does not have and does not want.

## What it does NOT mean

- It is not a default. The handler still decides what absence means — `track new` picks
  `track-N`, and that lives in the handler, not here.
- It does not make the arg unreachable. In k7's bar, **Tab** steps onto a trailing optional
  where **Enter** would run past it; see `apps/k7/frontend/docs/commandBar.md`.
- It changes no CLI behaviour. `argv` is the handler's to read, and a handler that treats an
  argument as optional needs no field to do it.
