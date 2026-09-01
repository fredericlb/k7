# The settings screen, and the line it draws

`/@settings` holds what a **browser** may change. Everything about a machine — which audio
interface the engine opens, whether the engine is running, the web UIs it trusts, autostart —
is the tray's menu (`engine/st0-tray/docs/tray.md`), and not because moving it here would be
hard: those settings need a process on that machine, and this page is served to any machine
that asks.

So the split is not desktop-versus-web. It is **whose disk answers**.

## One section today, and it is the deploy key

`SyncSection.tsx`. The key is what lets a repository be cloned or pushed at all, and nothing on
the home page works without it — which is why the home page links here rather than explaining
itself twice.

**It is made on the machine and never leaves it** (`packages/git-repos/docs/keys.md`), so there
is one per MACHINE and not one per account, and this screen asks a machine for it exactly as the
home page does. With no machine answering there is no key to read, and the screen says so
instead of offering a Generate button that would write nowhere.

The key is shown outside its row, in a block of its own: a `Row` truncates its label, and a
public key you can only see the start of is one you cannot check against what you pasted.

## The link is unconditional

It used to be drawn only where `/desktop/state` answered — a probe for the desktop app, which
served st0 from its own origin. There is no such app, and what this page holds was never the
app's anyway. A settings screen reachable only from one build is one nobody finds.

## Why the sections that were here are gone

Audio, Engine, Sessions, Server and Machine each drew a supervisor snapshot and sent commands
back. Every one of them is a row in the tray's menu, and the tray is the thing with a process on
the machine to send them to. Two screens for one setting is two that disagree the day one is
changed; `docs/rename-test-plan.md` says the same about names.
