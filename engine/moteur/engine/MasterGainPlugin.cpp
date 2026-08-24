#include "MasterGainPlugin.h"

namespace studio {

namespace te = tracktion::engine;

const char* MasterGainPlugin::xmlTypeName = "studio_master_gain";

namespace {
// The STORAGE bound, deliberately wider than any fader drawn, so widening the UI is not an engine change.
constexpr float gainMinDb = -100.0f, gainMaxDb = 24.0f;
}  // namespace

MasterGainPlugin::MasterGainPlugin(te::PluginCreationInfo info) : Plugin(std::move(info))
{
    gainValue_ = std::make_unique<juce::CachedValue<float>>();
    gainValue_->referTo(state, juce::Identifier("p_Gain"), getUndoManager(), 0.0f);
    gain_ = addParam("gain", "Gain", {gainMinDb, gainMaxDb});
    gain_->attachToCurrentValue(*gainValue_);
}

MasterGainPlugin::~MasterGainPlugin()
{
    notifyListenersOfDeletion();
    if (gain_ != nullptr) gain_->detachFromCurrentValue();
}

void MasterGainPlugin::restorePluginStateFromValueTree(const juce::ValueTree& v)
{
    if (auto* p = v.getPropertyPointer(gainValue_->getPropertyID()))
        *gainValue_ = static_cast<float>(*p);
    else
        gainValue_->resetToDefault();
    for (auto p : getAutomatableParameters()) p->updateFromAttachedValue();
}

void MasterGainPlugin::initialise(const te::PluginInitialisationInfo&)
{
    // Start ON the current value: ramping from unity would fade the song in every time you pressed play.
    applied_ = juce::Decibels::decibelsToGain(gain_->getCurrentValue());
}

void MasterGainPlugin::deinitialise() {}

void MasterGainPlugin::setGainDb(float db)
{
    if (gain_ != nullptr) gain_->setParameter(db, juce::sendNotification);
}

void MasterGainPlugin::applyToBuffer(const te::PluginRenderContext& ctx)
{
    const juce::ScopedNoDenormals noDenormals;  // see GraphDspPlugin::applyToBuffer
    if (ctx.destBuffer == nullptr) return;

    // dB straight to a linear gain, no fader curve — and at or below -100 dB that gain is zero, i.e. silence.
    const float target = juce::Decibels::decibelsToGain(gain_->getCurrentValue(), -100.0f);
    auto& buffer = *ctx.destBuffer;
    const int n = ctx.bufferNumSamples;
    if (n <= 0) return;

    // A RAMP when the level moved, flat when it did not — a click here is on everything at once.
    if (juce::approximatelyEqual(target, applied_)) {
        if (!juce::approximatelyEqual(target, 1.0f))
            buffer.applyGain(ctx.bufferStartSample, n, target);
    } else {
        buffer.applyGainRamp(ctx.bufferStartSample, n, applied_, target);
        applied_ = target;
    }
}

}  // namespace studio
