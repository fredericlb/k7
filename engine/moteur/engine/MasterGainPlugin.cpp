#include "MasterGainPlugin.h"

namespace studio {

namespace te = tracktion::engine;

const char* MasterGainPlugin::xmlTypeName = "studio_master_gain";

namespace {
// The range the PARAMETER accepts. It is wider than the fader any surface draws, and deliberately
// so: this is the storage bound, and the brain's schema is what decides what a person may ask for
// (MASTER_MIN_DB / MASTER_MAX_DB). A parameter that stopped where the UI does would turn a future
// widening into an engine change as well.
//
// -100 dB is where the fader curve elsewhere reaches zero, so it is what the rest of the app calls
// silence; +24 is well past anything a master trim is asked for and still finite.
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
    // Start ON the current value rather than at unity: initialise runs when playback starts, and
    // ramping up to a set level from 1.0 would fade the song in every time you pressed play.
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

    // dB straight to a linear gain — no fader curve, and that is the reason this plugin exists.
    // `decibelsToGain` treats anything at or below -100 dB as zero, which is what silence is here.
    const float target = juce::Decibels::decibelsToGain(gain_->getCurrentValue(), -100.0f);
    auto& buffer = *ctx.destBuffer;
    const int n = ctx.bufferNumSamples;
    if (n <= 0) return;

    // A RAMP when the level moved, flat when it did not. A master trim is one number for the whole
    // mix, so stepping it between two buffers would click on everything at once — the one artefact
    // that cannot be mistaken for a track's own.
    if (juce::approximatelyEqual(target, applied_)) {
        if (!juce::approximatelyEqual(target, 1.0f))
            buffer.applyGain(ctx.bufferStartSample, n, target);
    } else {
        buffer.applyGainRamp(ctx.bufferStartSample, n, applied_, target);
        applied_ = target;
    }
}

}  // namespace studio
