// EurorackPlugin.h — the Tracktion side every eurorack module shares: its parameters, the MIDI cut
// into segments so a note lands on its own sample, and the RateBridge to the core's fixed rate and
// block. A subclass declares its shape and parameters and renders one core block. docs/eurorack.md.

#pragma once

#include <tracktion_engine/tracktion_engine.h>

#include "RateBridge.h"

#include <atomic>
#include <memory>
#include <vector>

namespace studio::eurorack {

class EurorackPlugin : public tracktion::engine::Plugin, private RateBridge::Core {
public:
    ~EurorackPlugin() override;

    /** A module's state tree: the type and nothing else, so every parameter starts at its default. */
    static juce::ValueTree createState(const char* xmlTypeName);

    bool takesAudioInput() override { return shape_.inChannels > 0; }
    // Every module rings on after its input stops — a resonator, a grain cloud, a decay.
    bool producesAudioWhenNoAudioInput() override { return true; }
    bool noTail() override { return false; }
    int getNumOutputChannelsGivenInputs(int) override { return 2; }
    bool takesMidiInput() override { return shape_.midi; }
    // A second stereo pair past the first when the module has one, which is what makes it sidechainable (docs/sidechain.md).
    void getChannelNames(juce::StringArray* ins, juce::StringArray* outs) override;
    double getLatencySeconds() override;

    void initialise(const tracktion::engine::PluginInitialisationInfo&) override;
    void deinitialise() override {}
    void reset() override;
    /** A stop or a panic: every voice let go at the next block — the core is the audio thread's (docs/panic.md). */
    void midiPanic() override;
    void applyToBuffer(const tracktion::engine::PluginRenderContext&) override;
    void restorePluginStateFromValueTree(const juce::ValueTree&) override;

protected:
    struct Shape {
        double coreRate = 0.0;   // 0: runs at the host's rate
        int coreBlock = 16;      // frames per core call, fixed by the firmware
        int inChannels = 0;      // 0 for a generator; 2, or 4 with the sidechain pair
        bool midi = false;
    };

    EurorackPlugin(tracktion::engine::PluginCreationInfo, Shape);

    using Param = tracktion::engine::AutomatableParameter::Ptr;
    /** A continuous control, saved under `id`; `unit` only decorates the text. */
    Param knob(const char* id, const char* name, float min, float max, float def,
               const char* unit = "");
    /** A stepped control whose every state has a name, so a UI draws a menu rather than a slider. */
    Param choice(const char* id, const char* name, const juce::StringArray& labels, int def);
    static int index(const Param& p) { return juce::roundToInt(p->getCurrentValue()); }

    // --- what a module implements -----------------------------------------------------------

    /** Message thread, rate known: (re)initialise the core. Nothing on the audio thread allocates. */
    virtual void prepareCore(double coreRate) = 0;
    /** Audio thread, on a reset: empty what rings on — a reverb, a resonator, a grain buffer — without allocating. */
    virtual void clearCore() {}
    /** Audio thread, once per host block, before any segment: read the parameters into the core. */
    virtual void readParams() {}
    /** Audio thread, at the MIDI message's own sample. */
    virtual void handleMidi(const juce::MidiMessage&) {}
    /** Audio thread: one core block, planar, `coreBlock` frames; `in` is null for a generator. */
    void renderBlock(const float* const* in, float* const* out) override = 0;

    const Shape& shape() const { return shape_; }

private:
    struct Slot {
        Param param;
        std::unique_ptr<juce::CachedValue<float>> value;
    };
    std::vector<Slot> slots_;

    Shape shape_;
    RateBridge bridge_;
    // Asked on the message thread, done at the top of the next block, since the core and the bridge run on the audio thread.
    std::atomic<bool> releasePending_{false};
    std::atomic<bool> resetPending_{false};
    double hostRate_ = 48000.0;
    // Planar copies of the host block, input and sidechain, sized at initialise so the callback allocates nothing.
    std::vector<std::vector<float>> in_, out_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(EurorackPlugin)
};

}  // namespace studio::eurorack
