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

## Why it had to become a field

Several hints already said so in prose — *"optional — another track, of the same type as this
one"*. That told a person reading the catalogue and told no program anything. It cost nothing
while the only consumer was a CLI, where a handler reads `argv` and decides for itself.

It started costing the moment a **form** consumed the same catalogue. st0's command bar asks
for one param at a time and dispatches on the last one, so "how many are there" is the
question that decides when the line can run — and `args.length` answered four for a command
three of whose params you actually have to give. The bar could never dispatch a bare
`event move`, because it was still waiting for a param the command did not need. The prose
was right and unreachable.

So the rule the handlers already implemented is now written where the catalogue can be read:
`requiredCount` in st0's `commandFill.ts` is the whole consumer, and it is three lines.

## TRAILING only

Only a trailing run of optional params is dropped. `a b? c` requires all three.

This is not a limitation to be lifted later — it is what positional arguments mean. Skipping
`b` would shift `c` into `b`'s place, and the handler would receive an answer for a param
nobody gave. A param that is genuinely optional in the middle of a line needs a name at the
call site (a flag), which this vocabulary does not have and does not want.

## What it does NOT mean

- It is not a default. The handler still decides what absence means — `track new audio` picks
  `audio-N`, and that lives in the handler, not here.
- It does not make the arg unreachable. In st0's bar, **Tab** steps onto a trailing optional
  where **Enter** would run past it; see `apps/st0/frontend/docs/commandBar.md`.
- It changes no CLI behaviour. `argv` was always the handler's to read, and every handler that
  treats an argument as optional did so before this field existed.
