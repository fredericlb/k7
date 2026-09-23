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

So the split is not desktop-versus-web. It is **whose disk answers**. Two sections today, and they
sit at the two ends of that line: the LANGUAGE, which no disk answers for and which lives in this
browser alone, and the DEPLOY KEY, which only a machine can have made.

## Why a panel and not a page

The deploy key is pasted at a git host, and the list of repositories that need it is the reason
you are pasting it. A page replaces that list with the key; a panel keeps both on screen. The
same argument closed the address: `/@settings` was a route, a reserved repository name in
`@studio/web-protocol/projects` and a branch in `appMain.tsx`, all to show one section.

The prose in `RepoList.tsx` that points at the key therefore OPENS the panel rather than
linking: with no address there is nothing to link to, and a reader is one click from the thing
the sentence names.

## The language

`LanguageSection.tsx`, and it is the one row here that asks no machine anything: the language is
the BROWSER's. Paraglide keeps it under `PARAGLIDE_LOCALE` in `localStorage` — the strategy chain
this app compiles with is `["localStorage", "baseLocale"]` — so it is per browser and per machine,
travels with nothing, and survives no account. The same person on another laptop starts in English
again, which is the honest consequence of storing it where it is stored rather than a gap to fill:
what language you read in is a property of where you are sitting, not of who you are.

**English unless you say otherwise.** The shared setup
(`commons/packages/i18n/src/vite.ts`) puts `preferredLanguage` between the stored choice and the
base locale, so a browser asking for French gets French; st0 drops that middle strategy in its own
`vite.config.ts`. The reason is that this app is written in English — the commands, the file
syntax, the module names — and half of it is deliberately not translated at all (`i18n.ts` lists
which). A French browser landing on a French shell whose every verb is English reads as a broken
translation, where an English shell with a French option in the panel reads as a choice. It is an
app-level override and not a commons edit, which is the line that file already draws.

Each locale is named in **its own language** — English, Français — because the list is what you
read to find the one you want, and the one you are reading is the one you cannot pick: a button
that changes nothing is a button that looks broken.

The editor's own settings panel reaches the same value through `ui language <en|fr>`, and there is
no second store behind it — both doors call the runtime's `setLocale`, which writes that one key.
The panel is not itself a command, for the reason the deploy key's buttons are not: the home page
has no command bar, the palette being the project shell's.

### Where the words themselves live

Every string this app draws is in `messages/en.json` and `messages/fr.json`, reached as
`m["key"]()` — the compiled functions read the locale at call time, so a module outside React
(a status line, a refusal, a formatter) calls them exactly as a component does. Three rules the
sweep that moved them settled:

- **A sentence with something CLICKABLE in it stays one message.** Cutting it in two and letting
  each half keep English word order is the usual way this goes wrong, so the message keeps NAMED
  HOLES and `src/i18nParts.tsx` fills them with nodes. Each hole carries its name through the
  string, so a language that puts them in another order still gets the right node in each.
- **A table of static labels becomes a table of FUNCTIONS** (`() => m["…"]()`), never a table
  read once at module scope: the latter freezes whatever language was loaded first. `shapes.ts`,
  `timelineTools.ts`, `rollMode.ts`, `mastering/controls.ts` and the clip view's modes all follow
  it, and their consumers call `label()` rather than reading `label`.
- **`messages.test.ts` is the guard**: the two catalogues must name the same keys and ask for the
  same parameters. Nothing else in the build notices a key added to one and not the other — the
  screen just falls back to printing the key.

**A shared package under `packages/` has no catalogue and stays ENGLISH.** `ui-chains`,
`ui-chains-react`, `ui-turntables`, `ui-module-builder`, `project-shell` and `ui-app-switch` draw
inside this app and inside others, each with its own message set; a French string in one of them
is a French string in every host. What crosses that line is a `noun`-shaped hint the host hands
in, not a sentence. The same rule covers text a package writes into a FILE — the
`SURFACE_MAPPING_SKELETON` notes that end up as comments in `surfaces/<id>.yaml` are English
because the file is read where the code is.

## The deploy key

`SyncSection.tsx`. The key is what lets a repository be cloned or pushed at all, and nothing on
the home page works without it.

**It is made on the machine and never leaves it** (`packages/git-repos/docs/keys.md`), so there
is one per MACHINE and not one per account, and this panel asks a machine for it exactly as the
home page does. With no machine answering there is no key to read, and it says so instead of
offering a Generate button that would write nowhere.

The key is shown outside its row, in a block of its own: a `Row` truncates its label, and a
public key you can only see the start of is one you cannot check against what you pasted.

## Separation chains — the machine's, not a project's

`ChainsSection.tsx`. WHICH chain separates a record into stems, and which one gives it without its
voice (k7's « Make instrumental »). They were a section of the editor's I/O tab, which made them look
like a fact about the open project; they are not. Which module separates and which model it wants is
the same for every set list on this machine — `<state>/preferences.yaml` has always held them — so
they are set here, with no project open, and every surface that starts a separation only reads them.

**Only the library's COLD chains are offered** — a chain whose steps are all offline modules, the
only kind that can separate (`packages/song/docs/coldModules.md`); one that processes, or both
separates and processes, is not one. The file service lists them (`GET /account/cold-chains`),
against the bench's clone of the library. The instrumental picker narrows further, to the chains
whose offline step declares an `instrumental` output.

**A cold chain this machine cannot run YET is still listed**, and the reason shows under the picker
once it is chosen — almost always the model: a separation needs `htdemucs_fp16weights.onnx` (166 MB)
in `~/.st0/models`. The dropdown says which kind of "not yet" it is: « requires a download » when a
model it is missing has a `model_url` its module gives — a link under the picker then fetches it —
and « can't run here yet » when nothing here can fix it. (A chain missing both a downloadable model
and something else reads as the first: the reason under the picker still names the rest.) It was
first left out instead, and a library holding `stems` and `instrumental` then read as holding no
cold chain at all, on exactly the machine that needed telling what was missing. Choosing it is
allowed: the answer is the machine's, and it holds the day the model arrives.

Choosing writes through `PUT /account/cold-chains/stems|instrumental`, which checks the same list
again — the browser's copy is a menu, not the gate — and answers the new state, so a refused pick
snaps back. The empty option clears it: "this machine does not do that" is a real answer. A stored
chain the library no longer holds still shows, so a renamed chain does not read as "nothing is set".
`system stems` and `system instrumental` still set the same two answers from the command bar.

## Why the sections that were here are gone

Audio, Engine, Sessions, Server and Machine each drew a supervisor snapshot and sent commands
back, over a `/desktop/state` probe that only the desktop app ever answered. Every one of them
is a row in the tray's menu, and the tray is the thing with a process on the machine to send
them to. Two screens for one setting is two that disagree the day one is changed.
