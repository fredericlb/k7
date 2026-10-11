// DspGraph.h — a small DSP graph described as data and run in C++: the model @studio/dsp emits.
//
// The order of `nodes` is LOAD-BEARING, not merely a schedule. A sample-phase node reading a wire written LATER
// in the list gets the previous sample's value, and that is the unit delay every feedback topology is built on —
// so reordering the list changes the sound.
//
// The four phases, why the primitives stay small, what a sample-phase node costs a graph, and the three places
// the audio thread is kept from allocating: engine/st0-engine/docs/dspGraph.md. The emitting side, and the reasons
// the builder refuses things, is packages/dsp/docs/builder.md.

#pragma once

#include "NoteClock.h"

#include <tracktion_engine/tracktion_engine.h>

#include "Biquad.h"   // IIRFilter's arithmetic without its lock

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

    /** Run one block; `paramValues` is one per declared parameter, in order, so the graph never touches Tracktion. */
    void process(juce::AudioBuffer<float>& buffer, int startSample, int numSamples,
                 const float* paramValues, int numParams);

    /**
     * Run one block over MIDI: the control phase then the MIDI phase, no wire, delay line or filter.
     * `blockSeconds` and `secondsPerBeat` are what a node with a CLOCK needs, and the plugin is the
     * only side that can know either — see docs/midiGraph.md.
     */
    void processMidi(tracktion::engine::MidiMessageArray& midi,
                     const float* paramValues, int numParams,
                     double blockSeconds = 0.0, double secondsPerBeat = 0.5);

    /** Whether the description declares any MIDI node — what decides if a module is a transformer at all. */
    bool hasMidi() const { return hasMidiPhase_; }

    /** How many input PORTS the description reads: one past the highest `port` an `ain` names (docs/sidechain.md). */
    int inputs() const { return numInputs_; }

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
        ain, aout, adelay, amul, aadd, atanh, alfo, aallpass,
        // midi — block rate, rewriting the message list in place; their inputs are SCALARS, never wires
        transpose, velocity, mchannel,
        // …and the two that give the phase a MEMORY and a clock: what a note SOURCE needs (docs/midiGraph.md)
        mhold, mstrike,
        // …and the four that set which strikes play and how loud — the step rule, NoteSteps.h
        mpattern, maccent, mchance, mdecay,
    };

    static constexpr int MAX_IN = 4;
    // The widest buffer the sample phase indexes — four stereo ports; past it a port reads as unfed.
    static constexpr int MAX_CHANS = 8;

    struct Node {
        Kind kind = Kind::envelope;
        Phase phase = Phase::analysis;
        int out = -1;                       // scalar register, or an AUDIO wire for a sample-phase node
        int in[MAX_IN] = {-1, -1, -1, -1};  // ditto
        int k[MAX_IN] = {-1, -1, -1, -1};   // sample-phase only: its SCALAR inputs (params, literals)
        int delayLine = -1;                 // adelay: index into delayLines_
        float maxMs = 0.0f;
        int mode = 0;          // biquad's filter type, alfo's wave shape, or ain's input PORT — see build()
        float s0 = 0.0f;       // per-node state (envelope level, glide's last value)
        // aallpass: last input and last output, per channel — the one-sample memory no wire can hold.
        float x1[2] = {0.0f, 0.0f};
        float y1[2] = {0.0f, 0.0f};
        bool primed = false;
        studio::Biquad filters[2];
        // biquad: what the coefficients were last computed FROM, so a still knob costs nothing (docs/dspGraph.md).
        float lastFreq_ = -1.0f;
        float lastQ_ = -1.0f;
        float lastGainDb_ = -1000.0f;
    };

    std::vector<Node> nodes_;
    // Indices into nodes_ of the sample-phase ones, in declared order — see the end of build().
    std::vector<int> sampleNodes_;
    std::vector<DspGraphParam> params_;
    std::vector<float> regs_;
    // Audio wires: one stereo frame each, live only inside the per-sample loop.
    std::vector<std::array<float, 2>> awires_;
    std::vector<juce::String> aNames_;
    // One circular buffer per delay node, [channel][sample], sized at prepare() from its declared maximum.
    std::vector<std::array<std::vector<float>, 2>> delayLines_;
    std::vector<int> delayWrite_;
    // What the MIDI phase remembers between blocks: the keys down, the copies sounding, the step
    // clock. ONE per graph, like the note stream itself — see docs/midiGraph.md.
    NoteClock notes_;
    // The rule the strike consults, set by `mpattern`/`maccent`/`mchance`/`mdecay`; its defaults strike every step as played.
    NoteSteps steps_;
    // …and the events one block of it produces, sized once at build() so no block allocates.
    std::vector<NoteEvent> noteEvents_;
    tracktion::engine::MidiMessageArray notePassThrough_;
    bool hasSamplePhase_ = false;
    bool hasMidiPhase_ = false;
    // Whether any node is a `mix`, i.e. whether the dry snapshot is needed — fixed at build(), not asked per block.
    bool hasMix_ = false;
    int numInputs_ = 1;
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
