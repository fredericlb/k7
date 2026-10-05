# The settings page, and the line it draws

The user menu's Settings row, on the home page, opens `/settings`, a page of its own: `settings/SettingsPage.tsx`,
a route of the home page like `/libraries` (`appMain.tsx`), so going there reloads nothing.
The editor keeps its own settings as a panel (`components/SettingsPanel.tsx`), because those are
set while you look at the song they affect; these are not.

It holds what a **browser** may change. Everything about a machine — which audio interface the
engine opens, whether the engine is running, the web UIs it trusts, autostart — is the tray's
menu (`engine/st0-tray/docs/tray.md`), and not because moving it here would be hard: those
settings need a process on that machine, and this page is served to any machine that asks.

So the split is not desktop-versus-web. It is **whose disk answers**. Two sections today, and they
sit at the two ends of that line: the LANGUAGE, which no disk answers for and which lives in this
browser alone, and the DEPLOY KEY, which only a machine can have made.

## On the phone, the machine IS this page's

Inside the Android app (`engine/st0-engine/docs/android.md`) the line above moves, and for the
reason it was drawn: the process on the machine is the app st0 is running in, and the phone has no
tray to hold its menu. So the page's first sections are **this phone's engine** —
`settings/AndroidEngineSection.tsx`: the engine's state and Quit, the studios it is listed at and
which one the apps open, the private CA. The tray's hint is not drawn there, since it would point
at a menu that does not exist.

They are drawn only when `window.st0Android` is there (`settings/androidEngine.ts`), which the app
answers for st0's origin alone; a browser never sees them.

## Why a page and not a panel

Everything here is set once and left: the language, the deploy key pasted at a git host the day a
workspace is first pushed, the separation chains, the AI key. Visited on purpose and rarely — the
reasoning that made the libraries a page — it does not earn a column beside the repositories, and
a page gives it an ADDRESS. The two sentences in `RepoList.tsx` that name the deploy key are
therefore links to `/settings`.

The cost is that the list of repositories that need the key is not on screen while it is pasted.
It is one Back away, and the key is pasted once per machine.

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
translation, where an English shell with a French option on the settings page reads as a choice. It is an
app-level override and not a commons edit, which is the line that file already draws.

Each locale is named in **its own language** — English, Français — because the list is what you
read to find the one you want, and the one you are reading is the one you cannot pick: a button
that changes nothing is a button that looks broken.

The editor's own settings panel reaches the same value through `ui language <en|fr>`, and there is
no second store behind it — both doors call the runtime's `setLocale`, which writes that one key.
The page is not itself a command, for the reason the deploy key's buttons are not: the home page
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
`ui-chains-react`, `ui-turntables`, `ui-module-builder`, `project-shell` and `ui-user-menu` draw
inside this app and inside others, each with its own message set; a French string in one of them
is a French string in every host. What crosses that line is a `noun`-shaped hint the host hands
in, not a sentence. The same rule covers text a package writes into a FILE — the
`SURFACE_MAPPING_SKELETON` notes that end up as comments in `surfaces/<id>.yaml` are English
because the file is read where the code is.

## The deploy key

`SyncSection.tsx`. The key is what lets a repository be cloned or pushed at all, and nothing on
the home page works without it.

**It is made on the machine and never leaves it** (`packages/git-repos/docs/keys.md`), so there
is one per MACHINE and not one per account, and this page asks a machine for it exactly as the
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
against the library as this account reads it — an admin's own clone, else the server's. The instrumental picker narrows further, to the chains
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

## AI — the account's Claude key

`AiSection.tsx`. The key and model the module builder's AI organize runs on
(`packages/ui-module-builder/docs/aiOrganize.md`). It is here, on the settings page and not in
the editor's panel, because it belongs to the ACCOUNT: the same key serves every project and every
machine, and it is kept by st0's backend, the service that knows who you are.

**The key can be set, replaced and removed, and never read.** The row shows a hint
(`sk-ant-…wxyz`), enough to tell which key is stored and not enough to use it, and the field
empties once a key is saved. A key shown again is a key that can be copied from any browser left
logged in.

With no key, the builder draws no AI organize button rather than a dead one. That makes this
section the one place the feature can be found, and its row says so.

## Why there are no machine settings here

Audio, the engine, its sessions, the servers it is listed at and the machine itself are rows in
the tray's menu (`engine/st0-tray/docs/tray.md`), and the tray is the thing with a process on the
machine to send them to. A second screen for one setting is two that disagree the day one is
changed.
