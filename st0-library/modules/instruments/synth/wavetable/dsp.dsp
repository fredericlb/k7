// Wavetable — single-cycle frames of 2048 samples, end to end in the node's `Table` file. The note
// reads one frame, Position morphs between neighbours, then a resonant low-pass and an ADSR.
// `freq`, `gain` and `gate` are the voice allocator's, never knobs (engine/st0-engine/docs/faust.md).
import("stdfaust.lib");

freq = hslider("freq", 440, 20, 20000, 0.01);
gain = hslider("gain", 0.5, 0, 1, 0.01);
gate = button("gate");

position = hslider("Position", 0, 0, 1, 0.001) : si.smoo;
cutoff = hslider("Cutoff", 8000, 40, 20000, 1) : si.smoo;
resonance = hslider("Resonance", 1, 0.5, 10, 0.01);
attack = hslider("Attack", 0.01, 0.001, 4, 0.001);
decay = hslider("Decay", 0.3, 0.001, 4, 0.001);
sustain = hslider("Sustain", 0.7, 0, 1, 0.01);
release = hslider("Release", 0.4, 0.001, 8, 0.001);
glide = hslider("Glide", 0, 0, 2, 0.001);

table = soundfile("Table", 1);
N = 2048;

// How many frames the file holds: its length, read off the soundfile's first output.
frames = max(1, int(((0, 0) : table : _, !, !) / N));

// The pitch slides to each new note over Glide seconds, in log frequency so it moves evenly in pitch; 0 is a jump.
pitch = freq : log : si.smooth(ba.tau2pole(glide)) : exp;

// The read point inside one frame, and its neighbour for the linear interpolation.
ph = os.phasor(N, pitch);
i0 = int(ph);
fr = ph - i0;
i1 = (i0 + 1) % N;

// The two frames Position falls between.
fpos = position * (frames - 1);
f0 = int(fpos);
ff = fpos - f0;
f1 = min(f0 + 1, frames - 1);

read(f, i) = (0, f * N + i) : table : !, !, _;
sample(f) = read(f, i0) * (1 - fr) + read(f, i1) * fr;
osc = sample(f0) * (1 - ff) + sample(f1) * ff;

envelope = en.adsr(attack, decay, sustain, release, gate);
// Half scale: every frame is normalised to full, and a chord's voices add up.
process = osc * 0.5 : fi.resonlp(min(cutoff, ma.SR * 0.45), resonance, 1) : *(envelope * gain);
