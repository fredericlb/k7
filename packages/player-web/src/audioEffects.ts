/** Extract playback rate from effects map. Returns 1.0 if not set. */
export function getPlaybackRate(effects: Record<string, number>): number {
  const v = effects.speed;
  if (v == null || v <= 0) return 1.0;
  return v / 10;
}

/** Extract detune value in cents from effects map. Returns 0 if not set. */
export function getDetune(effects: Record<string, number>): number {
  const v = effects.pitch;
  if (v == null) return 0;
  return v * 100; // semitones to cents
}

export interface EffectChain {
  input: AudioNode;
  output: AudioNode;
  update(effects: Record<string, number>): void;
  disconnect(): void;
}

interface EffectInstance {
  input: AudioNode;
  output: AudioNode;
  update(intensity: number): void;
  disconnect(): void;
}

function createLowpass(ctx: AudioContext, intensity: number): EffectInstance {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 1;
  applyLowpass(filter, intensity);
  return {
    input: filter,
    output: filter,
    update: (i) => applyLowpass(filter, i),
    disconnect: () => filter.disconnect(),
  };
}

function applyLowpass(filter: BiquadFilterNode, intensity: number) {
  // 0 -> 20000 Hz, 100 -> 200 Hz (exponential)
  const t = intensity / 100;
  filter.frequency.value = 20000 * (200 / 20000) ** t;
}

function createHighpass(ctx: AudioContext, intensity: number): EffectInstance {
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.Q.value = 1;
  applyHighpass(filter, intensity);
  return {
    input: filter,
    output: filter,
    update: (i) => applyHighpass(filter, i),
    disconnect: () => filter.disconnect(),
  };
}

function applyHighpass(filter: BiquadFilterNode, intensity: number) {
  // 0 -> 20 Hz, 100 -> 20000 Hz (exponential)
  const t = intensity / 100;
  filter.frequency.value = 20 * (20000 / 20) ** t;
}

interface PhaserState {
  filters: BiquadFilterNode[];
  lfo: OscillatorNode;
  lfoGain: GainNode;
  dry: GainNode;
  wet: GainNode;
  input: GainNode;
  output: GainNode;
}

function createPhaser(ctx: AudioContext, intensity: number): EffectInstance {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  dry.gain.value = 0.5;
  wet.gain.value = 0.5;

  const filters: BiquadFilterNode[] = [];
  for (let i = 0; i < 4; i++) {
    const f = ctx.createBiquadFilter();
    f.type = "allpass";
    f.frequency.value = 1000;
    f.Q.value = 0.5;
    filters.push(f);
  }

  // Chain filters
  input.connect(dry);
  let prev: AudioNode = input;
  for (const f of filters) {
    prev.connect(f);
    prev = f;
  }
  prev.connect(wet);

  dry.connect(output);
  wet.connect(output);

  // LFO modulating filter frequencies
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.type = "sine";
  lfo.connect(lfoGain);
  for (const f of filters) {
    lfoGain.connect(f.frequency);
  }
  lfo.start();

  const state: PhaserState = { filters, lfo, lfoGain, dry, wet, input, output };
  applyPhaser(state, intensity);

  return {
    input,
    output,
    update: (i) => applyPhaser(state, i),
    disconnect: () => {
      lfo.stop();
      lfo.disconnect();
      lfoGain.disconnect();
      for (const f of filters) f.disconnect();
      dry.disconnect();
      wet.disconnect();
      input.disconnect();
      output.disconnect();
    },
  };
}

function applyPhaser(state: PhaserState, intensity: number) {
  const t = intensity / 100;
  // LFO depth: 0 -> 3500 Hz
  state.lfoGain.gain.value = t * 3500;
  // LFO rate: 0.1 -> 4 Hz
  state.lfo.frequency.value = 0.1 + t * 3.9;
}

function createOverdrive(ctx: AudioContext, intensity: number): EffectInstance {
  const shaper = ctx.createWaveShaper();
  shaper.oversample = "4x";
  applyOverdrive(shaper, intensity);
  return {
    input: shaper,
    output: shaper,
    update: (i) => applyOverdrive(shaper, i),
    disconnect: () => shaper.disconnect(),
  };
}

function applyOverdrive(shaper: WaveShaperNode, intensity: number) {
  const t = intensity / 100;
  const amount = 1 + t * 49; // 1x to 50x
  const samples = 8192;
  const curve = new Float32Array(samples);
  const norm = Math.tanh(amount); // normalize so ±1 input → ±1 output
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(amount * x) / norm;
  }
  shaper.curve = curve;
}

interface ChorusState {
  input: GainNode;
  output: GainNode;
  delay: DelayNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  dryGain: GainNode;
  wetGain: GainNode;
}

function createChorus(ctx: AudioContext, intensity: number): EffectInstance {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const delay = ctx.createDelay(0.1);
  delay.delayTime.value = 0.03;
  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  dryGain.gain.value = 0.7;
  wetGain.gain.value = 0.3;

  input.connect(dryGain);
  input.connect(delay);
  delay.connect(wetGain);
  dryGain.connect(output);
  wetGain.connect(output);

  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.type = "sine";
  lfo.connect(lfoGain);
  lfoGain.connect(delay.delayTime);
  lfo.start();

  const state: ChorusState = {
    input,
    output,
    delay,
    lfo,
    lfoGain,
    dryGain,
    wetGain,
  };
  applyChorus(state, intensity);

  return {
    input,
    output,
    update: (i) => applyChorus(state, i),
    disconnect: () => {
      lfo.stop();
      lfo.disconnect();
      lfoGain.disconnect();
      delay.disconnect();
      dryGain.disconnect();
      wetGain.disconnect();
      input.disconnect();
      output.disconnect();
    },
  };
}

function applyChorus(state: ChorusState, intensity: number) {
  const t = intensity / 100;
  // depth: 0 -> 0.02s
  state.lfoGain.gain.value = t * 0.02;
  // rate: 0.2 -> 5 Hz
  state.lfo.frequency.value = 0.2 + t * 4.8;
}

function createBitReduction(
  ctx: AudioContext,
  intensity: number,
): EffectInstance {
  // Use ScriptProcessorNode as a reliable fallback
  const bufferSize = 4096;
  const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
  let bitDepth = 16;

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const output = e.outputBuffer.getChannelData(0);
    const levels = 2 ** bitDepth;
    for (let i = 0; i < input.length; i++) {
      output[i] = Math.round(input[i] * levels) / levels;
    }
  };

  const update = (i: number) => {
    const t = i / 100;
    // 16 -> 2 bits
    bitDepth = 16 - t * 14;
  };
  update(intensity);

  return {
    input: processor,
    output: processor,
    update,
    disconnect: () => processor.disconnect(),
  };
}

const EFFECT_FACTORIES: Record<
  string,
  (ctx: AudioContext, intensity: number) => EffectInstance
> = {
  lowpass: createLowpass,
  highpass: createHighpass,
  phaser: createPhaser,
  overdrive: createOverdrive,
  chorus: createChorus,
  bitreduction: createBitReduction,
};

export function createEffectChain(
  ctx: AudioContext,
  effects: Record<string, number>,
): EffectChain {
  const input = ctx.createGain();
  const output = ctx.createGain();
  let instances: { key: string; instance: EffectInstance }[] = [];

  function rebuild(fx: Record<string, number>) {
    // Disconnect old chain
    for (const { instance } of instances) instance.disconnect();
    input.disconnect();

    const keys = Object.keys(fx).filter((k) => k in EFFECT_FACTORIES);
    instances = keys.map((key) => ({
      key,
      instance: EFFECT_FACTORIES[key](ctx, fx[key]),
    }));

    if (instances.length === 0) {
      input.connect(output);
      return;
    }

    // Chain: input -> effect1 -> effect2 -> ... -> output
    let prev: AudioNode = input;
    for (const { instance } of instances) {
      prev.connect(instance.input);
      prev = instance.output;
    }
    prev.connect(output);
  }

  rebuild(effects);

  return {
    input,
    output,
    update(fx: Record<string, number>) {
      const newKeys = Object.keys(fx)
        .filter((k) => k in EFFECT_FACTORIES)
        .sort();
      const oldKeys = instances.map((i) => i.key).sort();

      if (JSON.stringify(newKeys) !== JSON.stringify(oldKeys)) {
        // Different set of effects — rebuild
        rebuild(fx);
      } else {
        // Same effects — just update parameters
        for (const { key, instance } of instances) {
          instance.update(fx[key]);
        }
      }
    },
    disconnect() {
      for (const { instance } of instances) instance.disconnect();
      input.disconnect();
      output.disconnect();
    },
  };
}

/** Pitch wobble: LFOs at irrational ratios plus random drift on `source.detune`, for warped vinyl. */
export class PitchWobble {
  private oscs: OscillatorNode[] = [];
  private gains: GainNode[] = [];
  private driftInterval: number = 0;
  private ctx: AudioContext;

  constructor(ctx: AudioContext, target: AudioParam, intensity: number) {
    this.ctx = ctx;
    // 3 oscillators at irrational frequency ratios for complex, non-repeating wobble
    const baseFreqs = [0.23, 0.71, 1.37];
    for (const freq of baseFreqs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(target);
      osc.start();
      this.oscs.push(osc);
      this.gains.push(gain);
    }
    this.applyIntensity(intensity);
    // Periodically nudge frequencies for extra randomness
    this.driftInterval = window.setInterval(() => this.drift(), 800);
  }

  private applyIntensity(intensity: number) {
    const t = intensity / 100;
    // Depth: 0 → 0 cents, 100 → 600 cents (6 semitones wobble amplitude)
    const depths = [1.0, 0.6, 0.35]; // relative weights per oscillator
    const totalDepth = t * 600;
    for (let i = 0; i < this.gains.length; i++) {
      this.gains[i].gain.value = totalDepth * depths[i];
    }
    // Rate scaling: oscillator frequencies scale with intensity
    const rateScale = 0.3 + t * 3.0;
    const baseFreqs = [0.23, 0.71, 1.37];
    for (let i = 0; i < this.oscs.length; i++) {
      this.oscs[i].frequency.value = baseFreqs[i] * rateScale;
    }
  }

  private drift() {
    // Randomly nudge each oscillator's frequency by ±20% for organic feel
    for (const osc of this.oscs) {
      const base = osc.frequency.value;
      const jitter = base * (0.8 + Math.random() * 0.4);
      osc.frequency.setTargetAtTime(jitter, this.ctx.currentTime, 0.3);
    }
  }

  update(intensity: number) {
    this.applyIntensity(intensity);
  }

  disconnect() {
    clearInterval(this.driftInterval);
    for (const osc of this.oscs) {
      osc.stop();
      osc.disconnect();
    }
    for (const gain of this.gains) {
      gain.disconnect();
    }
    this.oscs = [];
    this.gains = [];
  }
}
