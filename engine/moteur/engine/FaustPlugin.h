// FaustPlugin.h — the built-in a `plugin: {type: faust}` module loads: handed its own Faust
// source in the document, it COMPILES it at load and runs the result. libfaust's interpreter
// backend, no LLVM — engine/moteur/docs/faust.md has the measurements and the traps.
//
// Its parameters are declared BY the program, which is why the source has to be readable in the
// constructor: Tracktion plugins create their AutomatableParameters there and never after. Same
// contract as GraphDspPlugin, which is why EditBuilder builds both from a ValueTree.

#pragma once

#include <tracktion_engine/tracktion_engine.h>

#include <memory>
#include <string>
#include <vector>

// Forward-declared so libfaust's headers stay out of everything that includes this one — the
// same rule EngineHost.h keeps for JUCE. The bare names are Faust's own.
class dsp;
class interpreter_dsp;
class interpreter_dsp_factory;
class mydsp_poly;

namespace studio {

class FaustPlugin : public tracktion::engine::Plugin {
public:
    explicit FaustPlugin(tracktion::engine::PluginCreationInfo info);
    ~FaustPlugin() override;

    static const char* getPluginName() { return "Faust"; }
    static const char* xmlTypeName;
    static juce::ValueTree create();

    /**
     * Where `import("stdfaust.lib")` is resolved from.
     *
     * Beside the executable first (`faust-libs/`, staged there by the tray's build), then the
     * path this build was configured with. Two tiers for the reason `hostcmd.rs` has three: the
     * dev path is inside `_deps/faust-src` and does not travel, and a shipped app that fell back
     * to it would fail to compile EVERY module at runtime with nothing to point at.
     */
    static juce::File faustLibrariesDir();

    juce::String getName() const override { return "Faust"; }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "Faust"; }
    juce::String getSelectableDescription() override { return "Faust"; }

    // Answered from the compiled program rather than assumed: a Faust module may be an effect
    // (`process = _ : …`) or an instrument (`process` with no input), and these two are what
    // tell Tracktion which it is looking at.
    bool takesAudioInput() override;
    bool producesAudioWhenNoAudioInput() override;
    /**
     * A program with no audio input is an INSTRUMENT, and an instrument is played by notes.
     *
     * Answered from the compiled program rather than declared anywhere: `process = _ : …` takes
     * audio and this is false, `process` with no input takes notes and it is true. Nothing in
     * `module.yaml` says which, and nothing should — the source already does.
     */
    bool takesMidiInput() override;
    bool noTail() override { return false; }

    int getNumOutputChannelsGivenInputs(int n) override;

    void initialise(const tracktion::engine::PluginInitialisationInfo&) override;
    void deinitialise() override;
    void reset() override;
    void applyToBuffer(const tracktion::engine::PluginRenderContext&) override;
    void restorePluginStateFromValueTree(const juce::ValueTree&) override;

private:
    /** Render `n` frames, cut at every note so each starts on its own sample. See the .cpp. */
    void renderWithNotes(const tracktion::engine::PluginRenderContext&, int n);

    std::string source_;
    interpreter_dsp_factory* factory_ = nullptr;
    interpreter_dsp* dsp_ = nullptr;
    /**
     * The polyphonic wrapper, for an instrument only — and it OWNS `dsp_` once it exists
     * (`~dsp_poly` deallocates the instance it was handed), so the destructor must not free both.
     */
    mydsp_poly* poly_ = nullptr;
    /** Whichever of the two is actually run: the voice group if there is one, else the instance. */
    ::dsp* run_ = nullptr;
    int numIn_ = 0, numOut_ = 0;

    // One entry per control the program declares, in the order buildUserInterface reported them.
    // `zone` points INTO the dsp instance; writing it is how a parameter reaches the program.
    std::vector<float*> zones_;
    std::vector<tracktion::engine::AutomatableParameter::Ptr> params_;
    std::vector<std::unique_ptr<juce::CachedValue<float>>> values_;

    // Faust's compute() must not be handed the same pointers for input and output — a program is
    // free to read an input after writing an output. So the block is rendered into these and
    // copied back. Sized at prepare, never in the callback.
    std::vector<std::vector<float>> in_, out_;
    // One pointer per channel INTO those, re-aimed per segment by renderWithNotes. Sized at
    // prepare so cutting a block at its notes allocates nothing in the callback.
    std::vector<float*> segIn_, segOut_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(FaustPlugin)
};

}  // namespace studio
