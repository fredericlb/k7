// docExt.ts — the extensions a workspace document may have, `.k7x` or YAML, for any name test.
// Says nothing about which one is still READ: that switch is node-side, in song's workspaceFile.ts.

/** The extension alternation as pattern source, for a regex that needs more around it. */
export const DOC_EXT_SRC = "\\.(?:ya?ml|k7x)";

/** A name ending in a document extension, either format and any case. */
export const DOC_EXT = new RegExp(`${DOC_EXT_SRC}$`, "i");

/** Does `name` end in a document extension. */
export const isDocFile = (name: string): boolean => DOC_EXT.test(name);

/** `name` without its document extension; any other name unchanged. */
export const stripDocExt = (name: string): string => name.replace(DOC_EXT, "");

/** A regex matching `prefix` (pattern source) followed by a document extension at the end. */
export const docPattern = (prefix: string, flags = "i"): RegExp =>
  new RegExp(`${prefix}${DOC_EXT_SRC}$`, flags);
