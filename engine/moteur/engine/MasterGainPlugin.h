// MasterGainPlugin.h — the song's output level, as a plain gain on the master bus.
//
// It exists because Tracktion's own master fader cannot go past +6 dB: `decibelsToVolumeFaderPosition`
// is `exp((dB - 6) / 20)` clamped to [0, 1], so every value above +6 sets the same position, silently.
// MixerPlugin borrows that curve and stops there on purpose; a master trim is the one place the ceiling
// is a limitation rather than a shape, since a mix built with headroom is asked for +12 routinely.
//
// So this one does not borrow the curve at all — dB straight to a linear gain, no mapping and no clamp.
// See packages/song/docs/masterVolume.md.

#pragma once

#include <tracktion_engine/tracktion_engine.h>

#include <memory>

namespace studio {

class MasterGainPlugin : public tracktion::engine::Plugin {
public:
    explicit MasterGainPlugin(tracktion::engine::PluginCreationInfo info);
    ~MasterGainPlugin() override;

    static const char* getPluginName() { return "Master gain"; }
    static const char* xmlTypeName;

    juce::String getName() const override { return "Master gain"; }
    juce::String getPluginType() override { return xmlTypeName; }
    juce::String getShortName(int) override { return "Out"; }
    juce::String getSelectableDescription() override { return "Master gain"; }
    bool takesAudioInput() override { return true; }
    bool producesAudioWhenNoAudioInput() override { return false; }
    bool noTail() override { return true; }

    int getNumOutputChannelsGivenInputs(int n) override { return n; }

    void initialise(const tracktion::engine::PluginInitialisationInfo&) override;
    void deinitialise() override;
    void applyToBuffer(const tracktion::engine::PluginRenderContext&) override;
    void restorePluginStateFromValueTree(const juce::ValueTree&) override;

    /** Set the level in dB. 0 is unity; there is no ceiling here, which is the whole point. */
    void setGainDb(float db);

private:
    tracktion::engine::AutomatableParameter::Ptr gain_;
    std::unique_ptr<juce::CachedValue<float>> gainValue_;
    // Ramped across the block: stepping a master between two buffers is a click on everything at once.
    float applied_ = 1.0f;
};

}  // namespace studio
