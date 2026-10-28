// moduleFiles.ts — the names of the files a module folder holds beside its ui.k7x, importing nothing.
// Apart from yaml/moduleSchema.ts so a caller that only needs a name does not load the schemas and zod with it.

/** The script beside `ui.k7x` that draws a panel's lcdscreen widgets — packages/ui-chains-react/docs/lcdScreen.md. */
export const WIDGETS_SCRIPT = "widgets.js";
