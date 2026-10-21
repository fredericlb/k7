# Shared UI packages: user menu and mini player

Two small packages exist because more than one screen of the studio draws the same thing. Both are raw TypeScript consumed as source, take React as a peer, and take every string as a prop.

## `@studio/ui-user-menu`

`packages/ui-user-menu/src/UserMenu.tsx` is the account menu: who is signed in, a Settings row, extra host rows, one link per **other** studio app of the origin, and Log out. It wraps the generic user menu of `@frediverse/ui` and adds the studio's table of apps (`APPS`, k7 first).

| Prop | Meaning |
|---|---|
| `self` | The app drawing it; its own row is left out. |
| `email` | The heading, null while unknown. |
| `onLogout` | The host's sign-out: each app reaches `/auth` from its own origin. |
| `onSettings`, `settingsLabel` | The Settings row and its translated name. |
| `items` | More host rows (the engine page on a machine's own backend, for instance). |
| `origin` | Where sibling apps resolve from when it is not this tab's origin — k7 on a machine's own backend passes the server it syncs with. |
| `unavailable` | Shown instead of the app rows when there is nowhere to go. |

Links are built with `serviceUrl(origin, id)` from `packages/web-protocol/services.ts`, the one table of where each studio service answers. k7 mounts the menu in its home sidebar (`apps/k7/frontend/src/projects/HomeSidebar.tsx`).

To add an app to the menu, add its service to `services.ts` and a row to `APPS`.

## `@studio/ui-mini-player`

`packages/ui-mini-player/src/MiniPlayer.tsx` is the transport bar at the bottom of a screen: an icon and title (with free-form `meta` and `status`), play/pause, a scrubber with `clock()` times, a close button, and optional children. It **owns no transport**: position, duration and playing state are props and every button is a callback, because its two hosts play very different things — the media library's player (`packages/ui-library/src/playback/MiniPlayer.tsx`) and k7's reference tracks (`apps/k7/frontend/src/components/ReferenceBar.tsx`). The scrubber is disabled until a duration is known.

`packages/ui-mini-player/src/mediaSession.ts` (`useMediaSession`) mirrors the same props into the browser's Media Session API (title, artist, album, position; play, pause, stop, seek, skip forward/back and, when `onNext` is given, next track), so a phone's lock screen and a headset's buttons drive the same callbacks. On the Android app the WebView's session reaches nothing, so the app relays these calls to a native session.

All labels (`region`, `play`, `pause`, `position`, `close`) come from the host's catalogue through `MiniPlayerLabels`.

## Checks

Neither package has tests; `npm run typecheck` in each compiles it. Their behaviour is checked through their hosts in the running app.
