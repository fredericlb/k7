# The practice list

An account's practice list is the songs and albums it is working on, a list of library paths kept
exactly as its favorites are (`src/media/routes/favorites.ts`): one store per account on the server
(`<prefs>/practice`), `/api/practice` for the page, `/api/sync/practice` for a paired device, and
the device door letting the paired machine's page reach it (`../../src/remote/door.ts`).

One module serves both lists, told apart by `key`: the same rules — a state per click, a paired
machine keeping no list of its own — must hold for both, and two copies would drift. The one
difference is the seed: only the favorites have an old field in the preferences file to start from.

The screens' side is `packages/ui-library/docs/library.md`, « Practice ».
