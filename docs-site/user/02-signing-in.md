# Signing in

Every page of k7 needs you signed in, except two kinds of public pages: a shared project link
(see [Sharing a project](./09-sharing.md)) and a rehearsal public page (`/rehearsal/@<nametag>`).
One sign-in covers the whole site: the editor, the media library and the rehearsal recorder.

## In a browser

1. Open the site's address, for example `https://st0.app/`.
2. The sign-in screen shows **k7**, the line "A text-based DAW. Sign in to open your projects and
   pick an engine.", and a **Sign in** button.
3. Click **Sign in**. You are sent to the site's account provider. Once you are signed in there,
   you come back to the page you started from, so a project link you opened while signed out opens
   that project.

The language switcher at the bottom of the sign-in screen sets the interface language (English or
French). You can change it later from **Settings** in the user menu.

### When the sign-in service is down

If the page says "The sign-in service is not answering…", signing in cannot work until that
service is back. The technical reason is shown under the message. Click **Try again** to check
again.

## Signing out

- From the home page: open the user menu at the bottom of the left sidebar and choose the logout
  entry.
- From inside a project: run `ui logout` in the command bar.

After signing out, the page reloads on the sign-in screen.

## In the desktop and Android apps

The desktop app and the phone app run k7 on the device itself. Their home page has an **account
bar** across the top (a plain browser does not show it).

### Signed out

When nobody is signed in, the app uses the machine's own local user. The bar says:

> Signed out: this is the machine's local user. Your account's workspaces keep syncing, and are
> listed again when you sign in.

You can still create and open projects. They belong to that local user.

### Signing in

1. Click the sign-in icon at the right of the account bar.
2. On the desktop app, a field opens that asks which k7 server to sync with. It is filled with the
   last server you used (`st0.app` is shown as an example). Type the server's address and press
   Enter, or click the sign-in icon beside the field. Press Escape or click the cross to cancel.
3. Sign-in finishes in your system browser. On a phone, the app opens the system browser directly.
4. Back in the app, the bar shows your name. Hovering it shows your email and the server you sync
   with.

To sign out, click the sign-out icon beside your name.

### The servers you sync with

When you are signed in on the desktop app, the account bar lists the servers under **Syncs with**:

| Control | What it does |
|---|---|
| **main** label | Marks the main server. Libraries and new workspaces come from it. |
| **Make main** | Makes another server the main one. |
| **Stop syncing with …** | Asks for confirmation, then stops syncing with that server. Its workspaces stay on this machine but no longer sync. Nothing is deleted on the server. |
| **Add a server** | Opens a field for another k7 server to sync with, beside the main one. Pairing finishes in the system browser, and the list grows once it has. |

When the account syncs with more than one server, each workspace row on the home page shows which
server it lives on (see [Workspaces](./04-workspaces.md#where-a-workspace-lives)).

## Older addresses

Two older host names still work and send you to the right place on the main site:

| Old address | Where it goes |
|---|---|
| `play.<site>` | The media library, `/media/…` |
| `k7.<site>` | The rehearsal recorder, `/rehearsal/…` |
