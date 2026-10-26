// index.ts — the transcription plugin: `track transcribe <track_in> <track_out>` — whisper
// listens to the video a picture lane places, and the transcript lands as subtitles placed on
// the picture lane <track_out>. The verb hosts in the CORE `track` family (its attribution is the installer's);
// everything the verb needs travelled with it (transcribe.ts, transcribeTrack.ts).

import { definePlugin, type K7Plugin } from "@studio/k7-sdk/plugin";
import { transcribeTrack } from "./transcribeTrack";

export const transcriptionPlugin: K7Plugin = definePlugin({
  id: "transcription",
  commands: [
    {
      sid: "track.transcribe",
      spec: {
        command: "track transcribe",
        sid: "track.transcribe",
        readable: {
          en: "Transcribe a video lane with whisper",
          fr: "Transcrire une piste vidéo avec whisper",
        },
        help: "whisper the video <track_in> places into subtitles on the picture lane <track_out> (e.g. track transcribe cam subs)",
        surfaces: ["cli"],
        menu: ["track"],
        args: [
          { name: "track_in", complete: "pictureLanes" },
          {
            name: "track_out",
            hint: "the picture lane showing the subtitles — created if new, its subtitles replaced if not",
          },
        ],
      },
      handler: transcribeTrack,
    },
  ],
});
