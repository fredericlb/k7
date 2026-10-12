# The live sync relay

`syncRelay.ts` orders the batches of every replica of an account's workspace and relays them, at
`/api/sync` on st0's backend. The ordering itself is `@studio/live-sync`'s Room
(`../../live-sync/docs/sync.md`). The plan is `../../../docs/live-sync-plan.md`, phase 3.

## In the hub, and authenticated by the hub's own secret

The replicas today are this hub's file services. Each already holds a secret the hub minted for it,
and the hub knows the account behind each secret (`instances.bySecret`). So a file service dials the
relay with the same `x-studio-hub-secret` it answers the hub with, and the relay knows its account
without a new credential. The hub hands every service the relay's address as `STUDIO_SYNC_URL`. A
service dials it only when `STUDIO_LIVE_SYNC=1`. Machines will need device tokens; that is phase 4.

## One socket per file service, every workspace on it

A file service serves all of an account's workspaces, so one socket carries them and each message
names its workspace. The relay keeps one Room per account and workspace, loaded on its first hello.

## On disk BEFORE it is relayed

Each ordered entry is appended to `entries.jsonl` before any replica hears of it. Every 200 entries
the room is saved whole to `room.json`, its open conflicts with it, and the log starts over. Loading a room is the saved state
plus the log replayed.

The order matters because of what a replica does on reconnecting. It says hello at the last `seq` it
applied. A room that forgot entries it had already relayed would be BEHIND that replica, and would
send it the room's older state to adopt, overwriting edits the replica had seen confirmed.

Rooms live in the account's folder, `<STUDIO_FILES_ROOT>/<account>/.sync-relay/<workspace>/`, beside
the account's file-service state and outside every workspace.

## In front of the other upgrade listeners

It installs itself in front of the existing `upgrade` listeners, as the rehearsal room does
(`../../rehearsal-server/src/rtc.ts`). The engine registry's listener closes an upgrade it does not
recognise when it is the only listener.
