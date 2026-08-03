#include "NamPlugin.h"

#include <NAM/get_dsp.h>

#include <exception>
#include <filesystem>

namespace studio {

// Renaming this renames the id a module.yaml may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* NamPlugin::xmlTypeName = "studio_nam";

namespace {

// The trims' range. Wide enough to rescue a badly levelled model, narrow enough that the knob still has
// resolution where you actually work — the same ±20 dB the official NAM plugin offers.
constexpr float TRIM_DB = 20.0f;

juce::String dbToText(float v) { return juce::String(v, 1) + " dB"; }
float textToDb(const juce::String& s) { return s.getFloatValue(); }

}  // namespace

NamPlugin::NamPlugin(tracktion::engine::PluginCreationInfo info)
    : Plugin(std::move(info))
{
    namespace te = tracktion::engine;
    auto* um = getUndoManager();

    inputDbValue.referTo(state, juce::Identifier("inputDb"), um, 0.0f);
    outputDbValue.referTo(state, juce::Identifier("outputDb"), um, 0.0f);
    // ON by default: a model that plays back at its trained loudness is the useful default, and the alternative
    // default — every profile arbitrarily quiet — is the bug this parameter exists to fix.
    normalizeValue.referTo(state, juce::Identifier("normalize"), um, 1.0f);

    inputDb = addParam("input", "Input", {-TRIM_DB, TRIM_DB}, dbToText, textToDb);
    outputDb = addParam("output", "Output", {-TRIM_DB, TRIM_DB}, dbToText, textToDb);
    // Discrete and labelled, so it reaches the UI as the two-state control it is rather than as a knob you have
    // to know sits at 0 or 1 — see pluginParams(), which turns exactly this into a dropdown.
    normalize = new te::DiscreteLabelledParameter("normalize", "Normalize", *this, {0.0f, 1.0f}, 2,
                                                  {"off", "on"});
    addAutomatableParameter(normalize);

    inputDb->attachToCurrentValue(inputDbValue);
    outputDb->attachToCurrentValue(outputDbValue);
    normalize->attachToCurrentValue(normalizeValue);
}

NamPlugin::~NamPlugin()
{
    notifyListenersOfDeletion();
    inputDb->detachFromCurrentValue();
    outputDb->detachFromCurrentValue();
    normalize->detachFromCurrentValue();
}

void NamPlugin::restorePluginStateFromValueTree(const juce::ValueTree& v)
{
    tracktion::engine::copyPropertiesToCachedValues(v, inputDbValue, outputDbValue, normalizeValue);
    for (auto p : getAutomatableParameters())
        p->updateFromAttachedValue();
}

std::optional<double> NamPlugin::modelLoudness() const
{
    if (!hasLoudness_.load(std::memory_order_relaxed))
        return std::nullopt;
    return loudnessDb_.load(std::memory_order_relaxed);
}

juce::ValueTree NamPlugin::create()
{
    // The ids live in tracktion::engine::IDs — unqualified they resolve to nothing, this namespace being pistes's.
    juce::ValueTree v(tracktion::engine::IDs::PLUGIN);
    v.setProperty(tracktion::engine::IDs::type, xmlTypeName, nullptr);
    return v;
}

void NamPlugin::initialise(const tracktion::engine::PluginInitialisationInfo& info)
{
    sampleRate_ = info.sampleRate;
    blockSize_ = info.blockSizeSamples;
    mono_.setSize(1, juce::jmax(1, blockSize_), false, true, false);

    // A model may already be loaded: the Edit is rebuilt on every project change and EditBuilder loads the model
    // right after construction, so this order is not fixed.
    const juce::SpinLock::ScopedLockType sl(lock_);
    if (dsp_ != nullptr)
        dsp_->Reset(sampleRate_, blockSize_);   // prewarms by default
}

void NamPlugin::deinitialise() {}

void NamPlugin::reset()
{
    const juce::SpinLock::ScopedLockType sl(lock_);
    if (dsp_ != nullptr)
        dsp_->Reset(sampleRate_, blockSize_);   // prewarms by default
}

juce::String NamPlugin::modelPath() const
{
    const juce::SpinLock::ScopedLockType sl(const_cast<juce::SpinLock&>(lock_));
    return path_;
}

bool NamPlugin::loadModel(const juce::File& file, juce::String& error)
{
    if (!file.existsAsFile()) {
        error = "no such file: " + file.getFullPathName();
        return false;
    }

    // Built OUTSIDE the lock — this reads a file, parses JSON and allocates the network — so the audio thread waits
    // only for a pointer assignment, never for a model load.
    std::unique_ptr<nam::DSP> loaded;
    try {
        loaded = nam::get_dsp(std::filesystem::path(file.getFullPathName().toStdString()));
    } catch (const std::exception& e) {
        error = juce::String("could not load model: ") + e.what();
        return false;
    }
    if (loaded == nullptr) {
        error = "could not load model (no error given)";
        return false;
    }

    // Prewarm HERE, not on the first block: a recurrent model starts cold and must run a while before it settles,
    // which is far too much work to do inside applyToBuffer. Reset() prewarms by default — ResetAndPrewarm is
    // deprecated upstream and goes away in NAM core v0.6.0.
    loaded->Reset(sampleRate_, blockSize_);

    const double rate = loaded->GetExpectedSampleRate();
    // Read BEFORE the move, and only behind HasLoudness(): GetLoudness() throws when the model declares none.
    const bool hasLoudness = loaded->HasLoudness();
    const double loudness = hasLoudness ? loaded->GetLoudness() : 0.0;
    {
        const juce::SpinLock::ScopedLockType sl(lock_);
        dsp_ = std::move(loaded);
        path_ = file.getFullPathName();
    }
    // Published after the swap and in this order, so a block that sees the new model never normalizes it by the
    // old one's loudness — worst case it runs one block un-normalized, which is a ramp, not a click.
    loudnessDb_.store(loudness, std::memory_order_relaxed);
    hasLoudness_.store(hasLoudness, std::memory_order_relaxed);
    // NAM_UNKNOWN_EXPECTED_SAMPLE_RATE (-1) means the model doesn't say — report 0 for "nothing to check".
    modelRate_.store(rate > 0.0 ? rate : 0.0, std::memory_order_relaxed);
    return true;
}

void NamPlugin::applyToBuffer(const tracktion::engine::PluginRenderContext& ctx)
{
    if (ctx.destBuffer == nullptr) return;

    const int numSamples = ctx.bufferNumSamples;
    const int start = ctx.bufferStartSample;
    const int numChans = ctx.destBuffer->getNumChannels();
    if (numSamples <= 0 || numChans <= 0) return;

    // try, not lock: a swap lasts a pointer assignment at most, and passing one block through dry beats a dropout.
    const juce::SpinLock::ScopedTryLockType sl(lock_);
    if (!sl.isLocked() || dsp_ == nullptr) return;

    // Read once for the block. Normalization folds into the output trim rather than being a separate multiply:
    // both are gains, and one ramp is cheaper and cannot drift out of step with the other.
    const float inGain = juce::Decibels::decibelsToGain(inputDb->getCurrentValue());
    float outDb = outputDb->getCurrentValue();
    if (normalize->getCurrentValue() >= 0.5f && hasLoudness_.load(std::memory_order_relaxed))
        outDb += (float)(targetLoudnessDb - loudnessDb_.load(std::memory_order_relaxed));
    const float outGain = juce::Decibels::decibelsToGain(outDb);

    // A block bigger than we prepared for (a render can hand out a long one). Growing here allocates, which is what
    // we avoid on the audio thread — but the alternative is a silent gap, worse than one allocation we then keep.
    if (mono_.getNumSamples() < numSamples) {
        mono_.setSize(1, numSamples, false, true, false);
        blockSize_ = numSamples;
        dsp_->Reset(sampleRate_, blockSize_);
    }

    // Sum to mono, since the model is one-in/one-out — averaged rather than added, so a stereo source doesn't hit
    // the amp 6 dB hotter; a model's input level is part of its sound.
    float* in = mono_.getWritePointer(0);
    {
        const float* l = ctx.destBuffer->getReadPointer(0, start);
        if (numChans > 1) {
            const float* r = ctx.destBuffer->getReadPointer(1, start);
            for (int i = 0; i < numSamples; ++i) in[i] = 0.5f * (l[i] + r[i]);
        } else {
            juce::FloatVectorOperations::copy(in, l, numSamples);
        }
    }

    // Ramped from where the last block ended — a gain that steps between blocks clicks, and Normalize is a step
    // of several dB the moment you toggle it. Applied to the mono buffer, so it costs one pass whatever the
    // channel count.
    mono_.applyGainRamp(0, 0, numSamples, lastInGain_, inGain);
    lastInGain_ = inGain;

    float* out = in; // in place: NAM allows input and output to be the same buffer
    dsp_->process(&in, &out, numSamples);

    mono_.applyGainRamp(0, 0, numSamples, lastOutGain_, outGain);
    lastOutGain_ = outGain;

    for (int ch = 0; ch < juce::jmin(numChans, 2); ++ch)
        juce::FloatVectorOperations::copy(
            ctx.destBuffer->getWritePointer(ch, start), out, numSamples);
}

}  // namespace studio
