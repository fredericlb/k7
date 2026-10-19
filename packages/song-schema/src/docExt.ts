// docExt.ts — the extension a workspace document has, `.k7x`, for any name test.
// A `.yaml` name is no workspace document: the media library's store and the config files beside it are read by name.

/** The extension as pattern source, for a regex that needs more around it. */
export const DOC_EXT_SRC = ".k7x";

/** A name ending in the document extension, any case. */
export const DOC_EXT = new RegExp(`${DOC_EXT_SRC}$`, "i");

/** Does `name` end in the document extension. */
export const isDocFile = (name: string): boolean => DOC_EXT.test(name);

/** `name` without its document extension; any other name unchanged. */
export const stripDocExt = (name: string): string => name.replace(DOC_EXT, "");

/** A regex matching `prefix` (pattern source) followed by the document extension at the end. */
export const docPattern = (prefix: string, flags = "i"): RegExp =>
  new RegExp(`${prefix}${DOC_EXT_SRC}$`, flags);
