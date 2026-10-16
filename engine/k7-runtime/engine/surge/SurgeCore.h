// SurgeCore.h — Surge XT's synthesizer behind a JUCE-free pimpl. Surge's core exports MAC, WINDOWS, UNICODE
// and friends as PUBLIC definitions, so its headers must never share a translation unit with JUCE. docs/surgePlugin.md.
//
// It renders FIXED blocks of block() samples: the caller slices the host's buffer and plays each event at the
// block it falls in. Build and load one on the message thread; once it is live, only the audio thread touches it.

#pragma once

#include <memory>
#include <string>
#include <vector>

namespace studio::surge {

/** One parameter the engine exposes: Surge's own, minus the MIDI ones, then the eight macros. */
struct ParamInfo {
    std::string id;       // stable across patches: `sx_` and Surge's storage name, or `macroN`
    std::string name;     // stable too: a scene prefix and Surge's name, generic where Surge's follows a type
    float min = 0, max = 1, def = 0;
    bool discrete = false;                // an integer range, where `choices` names each step
    std::vector<std::string> choices;    // a selector's labels, min first; empty for anything else
};

class SurgeCore {
public:
    static constexpr int MACROS = 8;

    // Message thread: building one reads Surge's tables and initialises a whole synth, a few milliseconds.
    explicit SurgeCore(double sampleRate);
    ~SurgeCore();

    /** The samples render() makes, fixed when Surge is compiled. */
    static int block();

    /** What every SurgeCore exposes, in order — the same list for every patch, read off a fresh synth. */
    static const std::vector<ParamInfo>& params();

    /** The parameters, and what each oscillator and effect type calls its slots, as JSON — what a panel is generated from. */
    static std::string layoutJson();

    // Message thread, BEFORE the core is live: reads the .fxp and applies it to this synth.
    bool loadPatch(const std::string& path, std::string& error);
    std::string patchName() const;

    // A parameter's value in its ParamInfo range, and Surge's own text for a value of it — read off THIS synth, so never a live one from another thread.
    float get(int i) const;
    std::string display(int i, float value) const;

    // --- audio thread -------------------------------------------------------

    void set(int i, float value);
    void setSampleRate(double sampleRate);
    void noteOn(int channel, int key, int velocity);
    void noteOff(int channel, int key, int velocity);
    void pitchBend(int channel, int centred);   // -8192..8191
    void controller(int channel, int cc, int value);
    void channelPressure(int channel, int value);
    void polyPressure(int channel, int key, int value);
    void allSoundOff();

    void render();
    const float* left() const;
    const float* right() const;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace studio::surge
