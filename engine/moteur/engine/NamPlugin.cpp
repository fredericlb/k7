#include "NamPlugin.h"

#include <NAM/get_dsp.h>

#include <exception>
#include <filesystem>

namespace studio {

// Renaming this renames the id a module.yaml may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* NamPlugin::xmlTypeName = "studio_nam";

namespace {

// The trims' range: the same ±20 dB the official NAM plugin offers, so a badly levelled model is rescuable.
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
    // ON by default: "every profile arbitrarily quiet, differently" is the bug this parameter exists to fix.
    normalizeValue.referTo(state, juce::Identifier("normalize"), um, 1.0f);

    inputDb = addParam("input", "Input", {-TRIM_DB, TRIM_DB}, dbToText, textToDb);
    outputDb = addParam("output", "Output", {-TRIM_DB, TRIM_DB}, dbToText, textToDb);
    // Discrete and labelled, so pluginParams() draws the two-state control it is rather than a 0-or-1 knob.
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
    // The ids live in tracktion::engine::IDs — unqualified they resolve to nothing, this namespace being st0's.
    juce::ValueTree v(tracktion::engine::IDs::PLUGIN);
    v.setProperty(tracktion::engine::IDs::type, xmlTypeName, nullptr);
    return v;
}

void NamPlugin::initialise(const tracktion::engine::PluginInitialisationInfo& info)
{
    sampleRate_ = info.sampleRate;
    blockSize_ = info.blockSizeSamples;
    mono_.setSize(1, juce::jmax(1, blockSize_), false, true, false);

    // A model may already be loaded: EditBuilder loads one right after construction, so this order is not fixed.
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

    // Built OUTSIDE the lock, so the audio thread waits for a pointer assignment and never for a model load.
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

    // Prewarm HERE, never on the first block: a recurrent model settles slowly, and Reset() prewarms by default.
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
    // Published after the swap, in this order: a new model normalized by the OLD loudness is the failure to avoid.
    loudnessDb_.store(loudness, std::memory_order_relaxed);
    hasLoudness_.store(hasLoudness, std::memory_order_relaxed);
    // NAM_UNKNOWN_EXPECTED_SAMPLE_RATE (-1) means the model doesn't say — report 0 for "nothing to check".
    modelRate_.store(rate > 0.0 ? rate : 0.0, std::memory_order_relaxed);
    return true;
}

void NamPlugin::applyToBuffer(const tracktion::engine::PluginRenderContext& ctx)
{
    // NAM's Eigen tensors are unprotected against denormals, and a model's tail is where they appear.
    const juce::ScopedNoDenormals noDenormals;
    if (ctx.destBuffer == nullptr) return;

    const int numSamples = ctx.bufferNumSamples;
    const int start = ctx.bufferStartSample;
    const int numChans = ctx.destBuffer->getNumChannels();
    if (numSamples <= 0 || numChans <= 0) return;

    // try, not lock: a swap lasts a pointer assignment at most, and passing one block through dry beats a dropout.
    const juce::SpinLock::ScopedTryLockType sl(lock_);
    if (!sl.isLocked() || dsp_ == nullptr) return;

    // Read once per block, with normalization FOLDED into the output trim: two gains, one ramp, no drift.
    const float inGain = juce::Decibels::decibelsToGain(inputDb->getCurrentValue());
    float outDb = outputDb->getCurrentValue();
    if (normalize->getCurrentValue() >= 0.5f && hasLoudness_.load(std::memory_order_relaxed))
        outDb += (float)(targetLoudnessDb - loudnessDb_.load(std::memory_order_relaxed));
    const float outGain = juce::Decibels::decibelsToGain(outDb);

    // A block bigger than we prepared for is CHUNKED, never grown: growing means a Reset, i.e. a prewarm here.
    const int chunk = mono_.getNumSamples();
    if (chunk <= 0) return;

    for (int done = 0; done < numSamples; done += chunk) {
        const int n = juce::jmin(chunk, numSamples - done);
        const int at = start + done;

        // Summed to mono by AVERAGE, not addition, so a stereo source does not hit the amp 6 dB hotter.
        float* in = mono_.getWritePointer(0);
        const float* l = ctx.destBuffer->getReadPointer(0, at);
        if (numChans > 1) {
            const float* r = ctx.destBuffer->getReadPointer(1, at);
            for (int i = 0; i < n; ++i) in[i] = 0.5f * (l[i] + r[i]);
        } else {
            juce::FloatVectorOperations::copy(in, l, n);
        }

        // The ramp spans the WHOLE block and each chunk takes its slice, so chunking is not a stair.
        const auto slice = [&](float from, float to, int upTo) {
            return from + (to - from) * ((float)upTo / (float)numSamples);
        };
        mono_.applyGainRamp(0, 0, n, slice(lastInGain_, inGain, done),
                            slice(lastInGain_, inGain, done + n));

        float* out = in; // in place: NAM allows input and output to be the same buffer
        dsp_->process(&in, &out, n);

        mono_.applyGainRamp(0, 0, n, slice(lastOutGain_, outGain, done),
                            slice(lastOutGain_, outGain, done + n));

        for (int ch = 0; ch < juce::jmin(numChans, 2); ++ch)
            juce::FloatVectorOperations::copy(
                ctx.destBuffer->getWritePointer(ch, at), out, n);
    }

    lastInGain_ = inGain;
    lastOutGain_ = outGain;
}

}  // namespace studio
