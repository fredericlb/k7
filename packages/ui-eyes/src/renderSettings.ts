// renderSettings.ts — the words that set a picture render, re-exported from song-schema, which
// owns them so the command layer reads them without this WebGL package.
// See packages/file-service/docs/serverRender.md.

export {
  parseVideoSettings,
  type VideoSettings,
} from "@studio/song-schema/renderSettings";
