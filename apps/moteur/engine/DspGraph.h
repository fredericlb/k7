// DspGraph.h — a small DSP graph, described as data and run in C++.
//
// The experiment behind it: can a module's DSP be a DESCRIPTION rather than a compiled plugin, so it can be
// authored in JS (or YAML) the way a chain already is? JS itself must never touch the audio thread — throughput
// is not the problem (a JS auto-wah measures 0.1% of a 5.3 ms block), a GC pause is — so the JS runs once, as a
// build step, and emits this. Same shape as Strudel, one layer down: JS produces data, the engine plays it.
//
// The model is three PHASES per block, which is what an envelope-driven effect actually is:
//
//   analysis  per sample over the input, writing scalars   (an envelope follower)
//   control   once per block, scalar -> scalar             (arithmetic, mapping, smoothing)
//   audio     per sample, transforming the buffer          (filters, gain, mix)
//
// …plus a fourth, SAMPLE phase for the graphs the three above cannot express: a delay whose output feeds back
// into its own input, a comb, a flanger. Those nodes run inside one per-sample loop over the block, in declared
// order, over their own register file of audio wires.
//
// Feedback falls out of that loop rather than needing machinery: a node reading a wire written LATER in the list
// gets the previous sample's value, which is the unit delay every feedback topology is built on. It is the
// standard reading of a signal-flow diagram, and it is why the order of `nodes` is load-bearing.
//
// Modulation is a sample-rate LFO writing an audio wire, not a control-rate one writing a scalar. A scalar can
// only change once per block, and on a delay TIME that is a ~10 ms staircase — audible as a zipper on exactly
// the effects modulation exists for. So `alfo` runs in the per-sample loop and `adelay` takes its time from a
// wire when given one, which is what makes a flanger expressible at all.
//
// A graph pays for what it uses. With no sample-phase node the audio phase stays block-rate, where a biquad runs
// through JUCE's vectorised processSamples and a gain through FloatVectorOperations; adding one moves that graph
// to per-sample dispatch. The auto-wah therefore still renders bit-identically to the compiled plugin, which is
// the regression this design is checked against.
//
// The primitives are deliberately SMALL. A first cut had `shape` and `geomap` nodes that were an auto-wah's
// steps wearing generic names; that way lies one primitive per effect, which defeats the point. The sensitivity
// curve and the direction switch now live in the description as arithmetic, which is where an effect's identity
// belongs.
//
// Every input is either a register name or a literal number; literals get their own preloaded register at build
// time. Scalars live in a register file resolved to INDICES when the graph is built, so process() does no
// lookups and no allocation. `sr` is predefined and holds the sample rate.

#pragma once

#include <tracktion_engine/tracktion_engine.h>

#include <array>
#include <memory>
#include <string>
#include <vector>

namespace studio {

/** A parameter the graph declares — the plugin turns each into an AutomatableParameter. */
struct DspGraphParam {
    std::string name;   // display name, and the register it writes
    float min = 0.0f, max = 1.0f, def = 0.0f;
    // Named settings make it a dropdown rather than a knob (see pluginParams); empty means continuous.
    std::vector<std::string> labels;
};

class DspGraph {
public:
    /** Build from parsed JSON. Returns nullptr and sets `error` when the description is unusable. */
    static std::unique_ptr<DspGraph> build(const juce::var& description, juce::String& error);

    const std::vector<DspGraphParam>& params() const { return params_; }

    void prepare(double sampleRate, int maxBlockSize);
    void reset();

    /**
     * Run one block. `paramValues` is one value per declared parameter, in order — the plugin reads its
     * AutomatableParameters once per block and hands them over, so the graph never touches Tracktion.
     */
    void process(juce::AudioBuffer<float>& buffer, int startSample, int numSamples,
                 const float* paramValues, int numParams);

    /**
     * Run one block over MIDI instead of audio — the same graph machinery, none of the audio phases.
     *
     * A MIDI transformer is a different shape of problem from an audio one: there is no per-sample loop and no
     * buffer, only a list of messages to rewrite once per block. So this runs the CONTROL phase (which is what
     * turns parameters into the numbers a transform needs) and then the MIDI phase, and never touches a wire,
     * a delay line or a filter. A graph with no MIDI node leaves the buffer alone.
     */
    void processMidi(tracktion::engine::MidiMessageArray& midi,
                     const float* paramValues, int numParams);

    /** Whether the description declares any MIDI node — what decides if a module is a transformer at all. */
    bool hasMidi() const { return hasMidiPhase_; }

private:
    enum class Phase { analysis, control, audio, sample, midi };
    enum class Kind {
        // analysis
        envelope,
        // control
        todb, fromdb, lerp, linmap, geolerp, clamp, select, add, sub, mul, glide,
        // audio (block rate)
        biquad, gain, mix,
        // sample rate — these read and write AUDIO wires, not scalars
        ain, aout, adelay, amul, aadd, atanh, alfo,
        // midi — block rate, rewriting the message list in place. Their inputs are SCALARS: a MIDI node has no
        // wire to read, it acts on the buffer the plugin handed over.
        transpose, velocity, mchannel,
    };

    static constexpr int MAX_IN = 4;

    struct Node {
        Kind kind = Kind::envelope;
        Phase phase = Phase::analysis;
        int out = -1;                       // scalar register, or an AUDIO wire for a sample-phase node
        int in[MAX_IN] = {-1, -1, -1, -1};  // ditto
        int k[MAX_IN] = {-1, -1, -1, -1};   // sample-phase only: its SCALAR inputs (params, literals)
        int delayLine = -1;                 // adelay: index into delayLines_
        float maxMs = 0.0f;
        int mode = 0;          // biquad: 0 band-pass, 1 low-pass, 2 high-pass, 3 notch
                               // alfo:   0 sine, 1 triangle, 2 saw, 3 square
        float s0 = 0.0f;       // per-node state (envelope level, glide's last value)
        bool primed = false;
        juce::IIRFilter filters[2];
    };

    std::vector<Node> nodes_;
    std::vector<DspGraphParam> params_;
    std::vector<float> regs_;
    // Audio wires: one stereo frame each, live only inside the per-sample loop.
    std::vector<std::array<float, 2>> awires_;
    std::vector<juce::String> aNames_;
    // One circular buffer per delay node, [channel][sample], sized at prepare() from its declared maximum.
    std::vector<std::array<std::vector<float>, 2>> delayLines_;
    std::vector<int> delayWrite_;
    bool hasSamplePhase_ = false;
    bool hasMidiPhase_ = false;
    int srReg_ = -1;
    double sampleRate_ = 44100.0;
    juce::AudioBuffer<float> dry_;

    // Build time only.
    std::vector<juce::String> regNames_;
    std::vector<std::pair<int, float>> constants_;   // register index -> the literal it holds
    int reg(const juce::String& name);
    int ref(const juce::var& v);
    int awire(const juce::var& v);

    float r(int i) const { return i >= 0 ? regs_[(size_t)i] : 0.0f; }
    void runControlNodes();
    void runControl(const float* paramValues, int numParams);

    JUCE_DECLARE_NON_COPYABLE(DspGraph)
    DspGraph() = default;
};

}  // namespace studio
