// exportQuality.ts — the quality words an export takes, apart from export.ts so the command line
// can name them without loading the muxer behind it. They live in song-schema's renderSettings.ts.

export {
  EXPORT_QUALITIES,
  type ExportQuality,
} from "@studio/song-schema/renderSettings";
