// MixBlend.h — a module's `@mix`, `@input-volume` and `@output-volume`: the engine's own stage around
// ANY plugin. A split before it trims the input and keeps the dry signal, a blend after it mixes that
// back in on the equal-power curve, delayed by the module's latency, then sets the level (docs/mix.md).
// The one thing a reader would get wrong: the pair is found by ADJACENCY — split right before, blend right after.

#pragma once

#include <tracktion_engine/tracktion_engine.h>

#include <atomic>
#include <memory>
#include <string>
#include <vector>

namespace studio {

/** The param name a module's blend is set by — an intrinsic, like `@gain` on an input. */
inline constexpr const char* kMixParam = "@mix";
/** …and the level into and out of the module, in dB — on the same stage (docs/mix.md). */
inline constexpr const char* kInputVolumeParam = "@input-volume";
inline constexpr const char* kOutputVolumeParam = "@output-volume";

/** What the split and the blend of one module share: the dry signal, and how much of it to keep. */
struct MixLink {
    static constexpr int CHANNELS = 2;
    // Frames, a power of two: ~2.7 s at 48 kHz, room for a plugin's latency and the largest block.
    static constexpr size_t CAPACITY = size_t(1) << 17;
    static constexpr size_t MASK = CAPACITY - 1;

    MixLink() : ring(CAPACITY * CHANNELS, 0.0f) {}

    std::atomic<float> mix{1.0f};          // 0 = all dry, 1 = all wet
    std::atomic<float> inGain{1.0f};       // linear, applied by the split before the module and the dry copy
    std::atomic<float> outGain{1.0f};      // linear, applied by the blend last
    std::vector<float> ring;               // interleaved dry frames, written by the split
    std::atomic<size_t> blockStart{0};     // where the split wrote this block's first frame
};

/** Before the module: copies what goes IN into the link's ring and passes it through untouched. */
class MixSplitPlugin : public tracktion::engine::Plugin {
public:
    explicit MixSplitPlugin(tracktion::engine::PluginCreationInfo info);
    ~MixSplitPlugin() override;

    static const char* getPluginName() { return "Mix Split"; }
    static const char* xmlTypeName;

    juce::String getName() const override { return "Mix Split"; }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "MixIn"; }
    juce::String getSelectableDescription() override { return "Mix Split"; }
    bool canBeDisabled() override { return false; }
    bool shouldMeasureCpuUsage() const noexcept override { return false; }
    bool noTail() override { return true; }
    bool takesAudioInput() override { return true; }
    bool producesAudioWhenNoAudioInput() override { return false; }
    int getNumOutputChannelsGivenInputs(int n) override { return juce::jmin(n, 2); }
    void initialise(const tracktion::engine::PluginInitialisationInfo&) override {}
    void deinitialise() override {}
    void restorePluginStateFromValueTree(const juce::ValueTree&) override {}
    void applyToBuffer(const tracktion::engine::PluginRenderContext&) override;

    /** Set BEFORE the plugin is inserted, so the audio thread never sees it without one. */
    void setLink(std::shared_ptr<MixLink> link) { link_ = std::move(link); }

private:
    std::shared_ptr<MixLink> link_;
    size_t write_ = 0;   // audio thread only
    float lastIn_ = -1.0f;   // the input gain the last block ended on
};

/** After the module: dry (delayed by the module's latency) and wet, on the equal-power curve. */
class MixBlendPlugin : public tracktion::engine::Plugin {
public:
    explicit MixBlendPlugin(tracktion::engine::PluginCreationInfo info);
    ~MixBlendPlugin() override;

    static const char* getPluginName() { return "Mix Blend"; }
    static const char* xmlTypeName;

    juce::String getName() const override { return "Mix Blend"; }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "MixOut"; }
    juce::String getSelectableDescription() override { return "Mix Blend"; }
    bool canBeDisabled() override { return false; }
    bool shouldMeasureCpuUsage() const noexcept override { return false; }
    bool noTail() override { return true; }
    bool takesAudioInput() override { return true; }
    bool producesAudioWhenNoAudioInput() override { return false; }
    int getNumOutputChannelsGivenInputs(int n) override { return juce::jmin(n, 2); }
    void initialise(const tracktion::engine::PluginInitialisationInfo&) override;
    void deinitialise() override {}
    void restorePluginStateFromValueTree(const juce::ValueTree&) override {}
    void applyToBuffer(const tracktion::engine::PluginRenderContext&) override;

    void setLink(std::shared_ptr<MixLink> link, tracktion::engine::Plugin::Ptr module);
    const std::shared_ptr<MixLink>& link() const { return link_; }

private:
    std::shared_ptr<MixLink> link_;
    // The module it blends around: its latency, and whether it is bypassed.
    tracktion::engine::Plugin::Ptr module_;
    std::atomic<int> latency_{0};
    // The gains the last block ENDED on, so a turn of the knob ramps instead of stepping.
    float lastWet_ = -1.0f, lastDry_ = 0.0f;
    float lastOut_ = -1.0f;
};

/** The blend after `module`, or null when the module has no `@mix`. */
MixBlendPlugin* mixBlendOf(tracktion::engine::Plugin& module);

/** Set `module`'s blend, putting the pair around it the first time. MESSAGE thread. */
void setModuleMix(tracktion::engine::Plugin& module, double mix);

/** Set the level into `module` (an effect) or out of it (anything with audio out), in dB. MESSAGE thread. */
void setModuleInputDb(tracktion::engine::Plugin& module, double db);
void setModuleOutputDb(tracktion::engine::Plugin& module, double db);

/** A stage's three values as a UI reads them: `@mix`, `@input-volume`, `@output-volume`. */
std::vector<std::pair<std::string, double>> stageParams(tracktion::engine::Plugin& module);

/** Where the NEXT module goes in `list`: past `module` and its blend. */
int indexAfterModule(tracktion::engine::PluginList& list, tracktion::engine::Plugin* module);

/** Which way a plugin's OWN blend param is held once the engine owns the blend: +1 all wet, -1 no dry, 0 not one. */
int ownMixSide(const std::string& paramName);

/** Which LEVEL a plugin's own param is, by name: +1 its input's, -1 its output's, 0 neither. */
int ownLevelSide(const std::string& paramName);

/** Hold `module`'s own params that one of the stage's three values replaces, and mark them held. MESSAGE thread. */
void holdOwnMix(tracktion::engine::Plugin& module);
void holdOwnLevel(tracktion::engine::Plugin& module, int side);

/** Is this param of `module` one the stage holds — so a live set of it is refused? */
bool heldByStage(const tracktion::engine::Plugin& module, const std::string& paramName);

/** Take the pair out with its module. MESSAGE thread. */
void removeMixPair(tracktion::engine::Plugin& module);

}  // namespace studio
