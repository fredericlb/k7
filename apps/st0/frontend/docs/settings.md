# The settings panel, and the line it draws

The cog on the home page opens a panel **docked at the right**, beside the repositories rather
than over them. `settings/HomeSettings.tsx`, opening and closing through the same
`components/RightPanel.tsx` the editor's column uses. It is the same shape the editor's own cog uses
(`components/SettingsPanel.tsx`), and for the same reason: settings are set while you look at
what they affect.

It holds what a **browser** may change. Everything about a machine — which audio interface the
engine opens, whether the engine is running, the web UIs it trusts, autostart — is the tray's
menu (`engine/st0-tray/docs/tray.md`), and not because moving it here would be hard: those
settings need a process on that machine, and this page is served to any machine that asks.

So the split is not desktop-versus-web. It is **whose disk answers**.

## Why a panel and not a page

The deploy key is pasted at a git host, and the list of repositories that need it is the reason
you are pasting it. A page replaces that list with the key; a panel keeps both on screen. The
same argument closed the address: `/@settings` was a route, a reserved repository name in
`@studio/web-protocol/projects` and a branch in `appMain.tsx`, all to show one section.

The prose in `RepoList.tsx` that points at the key therefore OPENS the panel rather than
linking: with no address there is nothing to link to, and a reader is one click from the thing
the sentence names.

## One section today, and it is the deploy key

`SyncSection.tsx`. The key is what lets a repository be cloned or pushed at all, and nothing on
the home page works without it.

**It is made on the machine and never leaves it** (`packages/git-repos/docs/keys.md`), so there
is one per MACHINE and not one per account, and this panel asks a machine for it exactly as the
home page does. With no machine answering there is no key to read, and it says so instead of
offering a Generate button that would write nowhere.

The key is shown outside its row, in a block of its own: a `Row` truncates its label, and a
public key you can only see the start of is one you cannot check against what you pasted.

## Why the sections that were here are gone

Audio, Engine, Sessions, Server and Machine each drew a supervisor snapshot and sent commands
back, over a `/desktop/state` probe that only the desktop app ever answered. Every one of them
is a row in the tray's menu, and the tray is the thing with a process on the machine to send
them to. Two screens for one setting is two that disagree the day one is changed.
