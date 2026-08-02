# General rules on development

- Prioritize using existing libraries whenever possible. When you found one, show its strengths and weaknesses and ask if you should include it. 
- Comments at the top of a file should summarize what the file is doing in less than 5 lines. If it is not possible to explain this clearly in <=5 lines, add a md file explaining it fully in docs/[topic].md
- Inline comments should be one-liners

# This repo

`studio` holds the music/stage apps: **radiok7** (rehearsal recorder),
**lanes** (text-first DAW, with a native C++ engine and a Tauri tray) and
**obscura** (blind-test game, six SPAs behind one origin).

`commons/` is a **git submodule** — the shared base, also used by the `phare`
monorepo. Editing something under `commons/` means committing in two places:

```bash
cd commons && git commit -am "…" && cd ..
git add commons && git commit -m "bump commons"
```

`push.recurseSubmodules=on-demand` is configured, so pushing the parent pushes
commons first. Never edit `commons/` for something only studio needs — put it in
`packages/` instead.

`packages/ui-waveform` (`@studio/ui-waveform`) is studio's own shared tier: it
is used by radiok7's recorder and by lanes' frontend, and by nothing in phare.
