# Tracktion built-ins with no registered parameters

Chorus and Phaser keep their controls as `juce::CachedValue<float>` members bound to
ValueTree properties (`depthMs.referTo (state, IDs::depthMs, um, 3.0f)`) instead of calling
`addParam()`. Nothing enumerates those, so without the table in `PluginParams.cpp` the
engine reports these plugins as having **no parameters at all** — which is exactly what
they looked like from the module editor.

The **defaults** in that table are copied from each plugin's constructor and are exact.
The **ranges** are ours: the plugin never publishes one, so they are read off how
`applyToBuffer()` consumes the value. They are advisory metadata for a UI, not a claim that
the plugin enforces them.

| plugin | property | how the value is used | range |
|---|---|---|---|
| chorus | `depthMs` | modulation depth added to a fixed 20 ms base delay | 0..20 ms |
| chorus | `speedHz` | LFO frequency, `2pi / (sampleRate / speedHz)` | 0..10 Hz |
| chorus | `width` | right-channel phase offset, used as `pi * width` | 0..1 |
| chorus | `mixProportion` | fed to `AudioFadeCurve::CrossfadeLevels`, a 0..1 crossfade | 0..1 |
| phaser | `depth` | octave span of the sweep, `range = pow(2, depth)` | 0..10 |
| phaser | `rate` | sweep rate, `pow(range, rate / (sampleRate / 2))` | 0..10 |
| phaser | `feedback` | feedback gain, `t = in + feedback * fv[7]` | 0..1 |

Note the phaser's member is `feedbackGain` but its **property** is `feedback` — the
property name is what matters here.
