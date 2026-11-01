// joinTake.ts — a recorded output's picture and its sound joined into one WebM, in the browser: the picture's packets
// copied as the MediaRecorder encoded them, the engine's wav encoded to Opus by WebCodecs, the file streamed to
// `writable` as it is made. No ffmpeg anywhere. What reads wrong: packets and samples are added INTERLEAVED, in time
// order, or the muxer holds a whole take of one track while it waits for the other. packages/song/docs/outputRecording.md.

import {
  ALL_FORMATS,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  canEncodeAudio,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Output,
  StreamTarget,
  type StreamTargetChunk,
  UrlSource,
  WebMOutputFormat,
} from "mediabunny";

/** The sound's rate in the file: Opus encodes at 48 kHz, so a take at another rate is resampled to it. */
const OPUS_RATE = 48_000;
/** Transparent for a mix: what a rehearsal recording is listened back at. */
const OPUS_BITRATE = 192_000;

/** Whether this browser can encode the sound: without WebCodecs' Opus, the picture and the sound are filed apart. */
export const canJoinTake = (): Promise<boolean> =>
  canEncodeAudio("opus", { sampleRate: OPUS_RATE, numberOfChannels: 2 }).catch(
    () => false,
  );

/** Write `picture`'s video under `sound`'s audio, as one WebM, to `writable`; both start at 0. */
export async function joinTake(opts: {
  picture: Blob;
  /** The engine's take, as a URL this page can read with ranges (the project's media route). */
  sound: string;
  writable: WritableStream<StreamTargetChunk>;
}): Promise<void> {
  const pic = new Input({
    source: new BlobSource(opts.picture),
    formats: ALL_FORMATS,
  });
  const snd = new Input({
    source: new UrlSource(opts.sound),
    formats: ALL_FORMATS,
  });
  try {
    const vt = await pic.getPrimaryVideoTrack();
    const at = await snd.getPrimaryAudioTrack();
    if (!vt?.codec) throw new Error("the picture holds no video to join");
    if (!at) throw new Error("the take holds no sound to join");
    const output = new Output({
      format: new WebMOutputFormat(),
      target: new StreamTarget(opts.writable),
    });
    const video = new EncodedVideoPacketSource(vt.codec);
    const audio = new AudioSampleSource({
      codec: "opus",
      bitrate: OPUS_BITRATE,
      transform: { sampleRate: OPUS_RATE },
    });
    output.addVideoTrack(video);
    output.addAudioTrack(audio);
    await output.start();
    // The first packet carries the decoder's config, which the muxer writes into the track's header.
    const decoderConfig = (await vt.getDecoderConfig()) ?? undefined;
    const packets = new EncodedPacketSink(vt).packets();
    const samples = new AudioSampleSink(at).samples();
    let p = await packets.next();
    let s = await samples.next();
    let first = true;
    while (!p.done || !s.done) {
      if (!p.done && (s.done || p.value.timestamp <= s.value.timestamp)) {
        await video.add(p.value, first ? { decoderConfig } : undefined);
        first = false;
        p = await packets.next();
      } else if (!s.done) {
        await audio.add(s.value);
        s.value.close();
        s = await samples.next();
      }
    }
    await output.finalize();
  } finally {
    pic.dispose();
    snd.dispose();
  }
}
