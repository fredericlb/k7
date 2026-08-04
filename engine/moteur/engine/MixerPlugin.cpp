#include "MixerPlugin.h"

namespace studio {

namespace te = tracktion::engine;

// Renaming this renames the id a module.yaml may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* MixerPlugin::xmlTypeName = "studio_mixer";

namespace {
// The strip's ranges, in the units a mixer is read in. Volume stops at +6 dB where Tracktion's fader does — a
// taller range would store a bigger number and still play +6 — and its floor is the same -60 dB the UI treats
// as silence. The tone knobs are ±18, generous for a strip and short of anything that would ring.
constexpr float volMinDb = -60.0f, volMaxDb = 6.0f;
constexpr float eqMinDb = -18.0f, eqMaxDb = 18.0f;
constexpr float midQ = 0.9f;  // wide enough to be a tilt rather than a notch
}  // namespace

MixerPlugin::MixerPlugin(te::PluginCreationInfo info) : Plugin(std::move(info))
{
    auto* um = getUndoManager();
    // Each parameter is backed by a CachedValue on the state, which is what makes it survive a save and reload
    // and what the doc's `params:` map writes into.
    const auto add = [&](const char* id, const char* name, float lo, float hi,
                         float def) -> te::AutomatableParameter::Ptr {
        auto value = std::make_unique<juce::CachedValue<float>>();
        value->referTo(state, juce::Identifier(juce::String("p_") + name), um, def);
        auto param = addParam(id, name, {lo, hi});
        param->attachToCurrentValue(*value);
        values_.push_back(std::move(value));
        return param;
    };

    volume_ = add("volume", "Volume", volMinDb, volMaxDb, 0.0f);
    // -1 hard left, 0 centre, +1 hard right — the way a pan is spoken, rather than the 0..1 a track file used.
    pan_ = add("pan", "Pan", -1.0f, 1.0f, 0.0f);
    lowGain_ = add("low", "Low", eqMinDb, eqMaxDb, 0.0f);
    midGain_ = add("mid", "Mid", eqMinDb, eqMaxDb, 0.0f);
    highGain_ = add("high", "High", eqMinDb, eqMaxDb, 0.0f);
}

MixerPlugin::~MixerPlugin()
{
    notifyListenersOfDeletion();
    for (auto* p : {volume_.get(), pan_.get(), lowGain_.get(), midGain_.get(), highGain_.get()})
        if (p != nullptr) p->detachFromCurrentValue();
}

void MixerPlugin::restorePluginStateFromValueTree(const juce::ValueTree& v)
{
    for (auto& value : values_)
        if (auto* p = v.getPropertyPointer(value->getPropertyID()))
            *value = static_cast<float>(*p);
        else
            value->resetToDefault();
    for (auto p : getAutomatableParameters())
        p->updateFromAttachedValue();
}

void MixerPlugin::initialise(const te::PluginInitialisationInfo&)
{
    reset();
}

void MixerPlugin::deinitialise() {}

void MixerPlugin::reset()
{
    for (auto* b : {&low_, &mid_, &high_})
        for (auto& f : b->ch) f.reset();
    coeffsValid_ = false;
}

void MixerPlugin::updateCoefficients(float lowDb, float midDb, float highDb)
{
    const auto rate = sampleRate > 0.0 ? sampleRate : 44100.0;
    const auto g = [](float db) { return juce::Decibels::decibelsToGain(db); };
    const auto lowC = juce::IIRCoefficients::makeLowShelf(rate, lowHz, 0.7071, g(lowDb));
    const auto midC = juce::IIRCoefficients::makePeakFilter(rate, midHz, midQ, g(midDb));
    const auto highC = juce::IIRCoefficients::makeHighShelf(rate, highHz, 0.7071, g(highDb));
    for (auto& f : low_.ch) f.setCoefficients(lowC);
    for (auto& f : mid_.ch) f.setCoefficients(midC);
    for (auto& f : high_.ch) f.setCoefficients(highC);
    lastLowDb_ = lowDb;
    lastMidDb_ = midDb;
    lastHighDb_ = highDb;
    coeffsValid_ = true;
}

void MixerPlugin::applyToBuffer(const te::PluginRenderContext& ctx)
{
    if (ctx.destBuffer == nullptr) return;
    auto& buffer = *ctx.destBuffer;
    const int numChans = juce::jmin(buffer.getNumChannels(), 2);
    const int n = ctx.bufferNumSamples;
    if (numChans <= 0 || n <= 0) return;

    const float lowDb = lowGain_->getCurrentValue();
    const float midDb = midGain_->getCurrentValue();
    const float highDb = highGain_->getCurrentValue();
    // Recomputed only when a knob has actually moved: designing three biquads is far from free, and a strip's
    // tone knobs sit still for hours at a time.
    if (!coeffsValid_ || lowDb != lastLowDb_ || midDb != lastMidDb_ || highDb != lastHighDb_)
        updateCoefficients(lowDb, midDb, highDb);

    // Tone first, then level — a fader after the EQ is what a strip is, and it keeps the metering downstream
    // reading what the track actually sends on.
    for (int ch = 0; ch < numChans; ++ch) {
        auto* d = buffer.getWritePointer(ch, ctx.bufferStartSample);
        low_.ch[ch].processSamples(d, n);
        mid_.ch[ch].processSamples(d, n);
        high_.ch[ch].processSamples(d, n);
    }

    // Tracktion's own fader maths, so this reproduces the track volume/pan it replaces rather than approximating
    // it: the same fader curve, and the project's own pan law rather than one invented here.
    float leftGain = 1.0f, rightGain = 1.0f;
    te::getGainsFromVolumeFaderPositionAndPan(
        te::decibelsToVolumeFaderPosition(volume_->getCurrentValue()), pan_->getCurrentValue(),
        te::getDefaultPanLaw(), leftGain, rightGain);

    if (numChans == 1) {
        // Mono in, mono out: there is no second channel to pan into, so the pan can only be a level change and
        // applying half of one would just make the track quieter for no reason a fader shows.
        buffer.applyGain(0, ctx.bufferStartSample, n, (leftGain + rightGain) * 0.5f);
    } else {
        buffer.applyGain(0, ctx.bufferStartSample, n, leftGain);
        buffer.applyGain(1, ctx.bufferStartSample, n, rightGain);
    }
}

}  // namespace studio
