# commands — one verb list for every surface

`packages/commands` is the command layer: `commands.yaml` declares every command — its name, its arguments, what completes them — and `SID_HANDLERS` implements them once.

The CLI, the web command bar and the key bindings all dispatch through it, so a command added here appears everywhere at once, with completion, without a line of UI code.

Edits go through the same surgical text helpers the editor uses: a command that changes one parameter rewrites that field's span and leaves the rest of the file byte-identical — comments and hand-authored formatting survive.
