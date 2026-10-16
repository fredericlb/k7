// FaustPlugin.h — the built-in a `plugin: {type: faust}` module loads: handed its own Faust
// source in the document, it COMPILES it at load and runs the result. libfaust's interpreter
// backend, no LLVM — engine/k7-runtime/docs/faust.md has the measurements and the traps.
//
// Its parameters are declared BY the program, which is why the source has to be readable in the
// constructor: Tracktion plugins create their AutomatableParameters there and never after. Same
// contract as GraphDspPlugin, which is why EditBuilder builds both from a ValueTree.

#pragma once

#include <tracktion_engine/tracktion_engine.h>

#include <atomic>
#include <map>
#include <memory>
#include <string>
#include <vector>

// Forward-declared so libfaust's headers stay out of every includer — the bare names are Faust's own.
class dsp;
class interpreter_dsp;
class interpreter_dsp_factory;
class mydsp_poly;
struct Soundfile;

namespace studio {

class FaustPlugin : public tracktion::engine::Plugin {
public:
    explicit FaustPlugin(tracktion::engine::PluginCreationInfo info);
    ~FaustPlugin() override;

    static const char* getPluginName() { return "Faust"; }
    static const char* xmlTypeName;
    static juce::ValueTree create();

    /** Where `import("stdfaust.lib")` is resolved from: beside the executable first, the build's path last. */
    static juce::File faustLibrariesDir();

    juce::String getName() const override { return "Faust"; }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "Faust"; }
    juce::String getSelectableDescription() override { return "Faust"; }

    // Answered from the COMPILED program: `process = _ : …` is an effect, `process` with no input an instrument.
    bool takesAudioInput() override;
    bool producesAudioWhenNoAudioInput() override;
    /** True for an instrument, i.e. a program with no audio input — nothing in `module.yaml` says which. */
    bool takesMidiInput() override;
    bool noTail() override { return false; }

    int getNumOutputChannelsGivenInputs(int n) override;

    void initialise(const tracktion::engine::PluginInitialisationInfo&) override;
    void deinitialise() override;
    void reset() override;
    /** A stop: every voice to its release, on the NEXT block — this arrives on the message thread (docs/panic.md). */
    void midiPanic() override;
    void applyToBuffer(const tracktion::engine::PluginRenderContext&) override;
    void restorePluginStateFromValueTree(const juce::ValueTree&) override;

private:
    // A stop or a panic on the message thread only raises this; the next block clears the state it owns (docs/panic.md).
    std::atomic<bool> resetPending_{false};
    // …and a stop only raises this one: the voices are released, not cleared, so a tail still decays.
    std::atomic<bool> releasePending_{false};
    void clearState();
    /** Render `n` frames, cut at every note so each starts on its own sample. See the .cpp. */
    void renderWithNotes(const tracktion::engine::PluginRenderContext&, int n);

    std::string source_;
    /** The files the program's `soundfile(...)` slots play, by slot LABEL — the node names them (docs/faust.md). */
    std::map<std::string, std::string> files_;
    /** Each file read once and shared by every voice; an unnamed or unreadable slot gets the empty one. */
    std::map<std::string, std::unique_ptr<Soundfile>> sounds_;
    /** Point every voice's soundfile slots at their sounds — after EVERY init, which may reset them. */
    void attachSounds();
    interpreter_dsp_factory* factory_ = nullptr;
    interpreter_dsp* dsp_ = nullptr;
    /** The voice group, for an instrument only — and it OWNS `dsp_`, so the destructor frees one, never both. */
    mydsp_poly* poly_ = nullptr;
    /** Whichever of the two is actually run: the voice group if there is one, else the instance. */
    ::dsp* run_ = nullptr;
    int numIn_ = 0, numOut_ = 0;

    /** One entry per PARAMETER, holding EVERY voice's zone for it — see the `group: false` note in the ctor. */
    std::vector<std::vector<float*>> zones_;
    std::vector<tracktion::engine::AutomatableParameter::Ptr> params_;
    std::vector<std::unique_ptr<juce::CachedValue<float>>> values_;

    // Separate in and out, since a `.dsp` may read an input after writing an output; sized at prepare.
    std::vector<std::vector<float>> in_, out_;
    // One pointer per channel INTO those, re-aimed per segment by renderWithNotes — also sized at prepare.
    std::vector<float*> segIn_, segOut_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(FaustPlugin)
};

}  // namespace studio
