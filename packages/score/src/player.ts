// player.ts — a score's MIDI played through a SoundFont: spessasynth_lib's synthesizer in an AudioWorklet
// and its sequencer. Built on the first Play, since its worklet and its 1 MB soundfont load then (../docs/score.md).
// The one thing a reader would get wrong: a song just handed over is not seekable until `songChange` says so.

import { Sequencer, WorkletSynthesizer } from "spessasynth_lib";
import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url";

export class ScorePlayer {
  private readonly ctx: AudioContext;
  private readonly synth: WorkletSynthesizer;
  private readonly seq: Sequencer;
  private loaded: Promise<void> = Promise.resolve();

  private constructor(ctx: AudioContext, synth: WorkletSynthesizer) {
    this.ctx = ctx;
    this.synth = synth;
    this.seq = new Sequencer(synth);
  }

  /** The synthesizer ready to play, its soundfont loaded; call it from a click, which lets the audio start. */
  static async create(soundFont: string): Promise<ScorePlayer> {
    const ctx = new AudioContext();
    await ctx.audioWorklet.addModule(processorUrl);
    const synth = new WorkletSynthesizer(ctx);
    synth.connect(ctx.destination);
    const bank = await (await fetch(soundFont)).arrayBuffer();
    await synth.soundBankManager.addSoundBank(bank, "main");
    await synth.isReady;
    return new ScorePlayer(ctx, synth);
  }

  /** Called when the song plays to its end. */
  onEnd(callback: () => void): void {
    this.seq.eventHandler.addEvent("songEnded", "score-view", callback);
  }

  /** Hand over a new MIDI, at `at` seconds into it; it plays only if it was playing. */
  load(midi: ArrayBuffer, at = 0): Promise<void> {
    const wasPlaying = !this.seq.paused;
    this.loaded = new Promise((done) => {
      this.seq.eventHandler.addEvent("songChange", "score-view-load", () => {
        this.seq.currentTime = at;
        if (wasPlaying) this.seq.play();
        else this.seq.pause();
        done();
      });
    });
    this.seq.loadNewSongList([{ binary: midi }]);
    return this.loaded;
  }

  async play(): Promise<void> {
    await this.ctx.resume();
    await this.loaded;
    this.seq.play();
  }

  pause(): void {
    this.seq.pause();
  }

  stop(): void {
    this.seq.pause();
    this.seq.currentTime = 0;
    this.synth.stopAll(true);
  }

  seek(seconds: number): void {
    this.seq.currentTime = seconds;
  }

  get playing(): boolean {
    return !this.seq.paused;
  }

  /** Where playback is, in seconds, smoothed for a cursor. */
  get time(): number {
    return this.seq.currentHighResolutionTime;
  }

  destroy(): void {
    this.seq.pause();
    this.synth.destroy();
    void this.ctx.close().catch(() => {});
  }
}
