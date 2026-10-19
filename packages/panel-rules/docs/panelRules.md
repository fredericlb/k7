# The panel's rules, apart from the builder

`@studio/panel-rules` holds what decides whether a module's panel is valid — a group frames what
lies wholly inside its box (`src/groupGeometry.ts`), the horizontal and vertical layouts offer the
same controls (`src/layoutTwins.ts`) — the one way a panel is printed as `ui.k7x`, a widget a line
(`src/panelText.ts`), and AI organize's wire, answer, check and system prompt built on them
(`src/aiOrganize.ts`, `src/aiAnswer.ts`, `src/aiPrompt.ts`). What the rules ARE is the builder's to explain:
`packages/ui-module-builder/docs/builder.md`, `layouts.md` and `aiOrganize.md` there.

## Why a package of its own

Two ends apply these rules: the builder's grid in the browser, and k7's backend, which checks a
proposal from Claude before it reaches the browser (`apps/k7/backend/src/aiOrganize.ts`). The
builder is React, CodeMirror and Radix; a backend importing the check from it would carry all of
that in its production install, and in the server image, for some 850 lines of pure functions.

So the rules have no React and no DOM, and depend on the file format (`@studio/song-schema`,
`@studio/k7x`) and nothing above it. The builder imports them like any other host, and still answers
`@studio/ui-module-builder/ai-organize` for the frontend that reaches AI organize's types
through it.

A rule the grid enforces belongs here when the AI check must enforce it too; one that only the
editing gestures care about stays in the builder.
