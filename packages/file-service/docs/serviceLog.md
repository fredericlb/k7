# serviceLog.ts — the file service's own lines, for st0's Logs panel

The Logs panel has two halves. One is the engine machine's `.studio.log` — the supervisor's and the
engine's lines — fetched over the tunnel (`machineLog.ts`). The other is THIS process: what the file
service writes through `console`, which used to reach only the hub's output (and Tilt's pane in
development), where nobody using st0 would look.

`installServiceLog()`, first thing in `server.ts`, tees `console.log/info/warn/error`: the original
output is written exactly as before, and each call is also kept as one numbered line, with its level,
in a buffer of the last `SERVICE_LOG_LINES` (1000).

`GET /logs` answers both halves: the machine's as before (`offset` / `tail`), and
`service: { seq, lines }` — the lines after `?after=S`, or the last `tail` with no cursor. A cursor
higher than anything here belongs to a previous process (the service restarted and began numbering
again), so it answers from the start rather than nothing forever.

**One account per process**, as the hub runs them (`packages/file-hub/docs/fileHub.md`): what one
account's panel shows is its own service's lines, and nobody else's.

The panel draws a service line as `[file] …`, in the `file` colour, and a `warn` or `error` one in
red.
