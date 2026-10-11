#include "NamPlugin.h"

#include <cmath>
#include <iostream>

namespace studio {

// Renaming this renames the id a module.yaml may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* NamPlugin::xmlTypeName = "studio_nam";

namespace {

// The model's fixed block when resampled: small, since the bridge's latency grows with it.
constexpr int BRIDGE_BLOCK = 32;

// The trims' range: the same ±20 dB the official NAM plugin offers, so a badly levelled model is rescuable.
constexpr float TRIM_DB = 20.0f;

juce::String dbToText(float v) { return juce::String(v, 1) + " dB"; }
float textToDb(const juce::String& s) { return s.getFloatValue(); }
juce::String knobToText(float v) { return juce::String(v, 2); }
float textToKnob(const juce::String& s) { return s.getFloatValue(); }

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

    // Generic names: what a knob does is the model's, and a module's panel labels it (docs/namPlugin.md).
    for (int k = 0; k < AmpModel::MAX_KNOBS; ++k) {
        const auto id = "knob" + juce::String(k + 1);
        knobValue[k].referTo(state, juce::Identifier(id), um, 0.5f);
        knob[k] = addParam(id, "Knob " + juce::String(k + 1), {0.0f, 1.0f}, knobToText, textToKnob);
        knob[k]->attachToCurrentValue(knobValue[k]);
    }
}

NamPlugin::~NamPlugin()
{
    notifyListenersOfDeletion();
    inputDb->detachFromCurrentValue();
    outputDb->detachFromCurrentValue();
    normalize->detachFromCurrentValue();
    for (auto& k : knob) k->detachFromCurrentValue();
}

void NamPlugin::restorePluginStateFromValueTree(const juce::ValueTree& v)
{
    tracktion::engine::copyPropertiesToCachedValues(v, inputDbValue, outputDbValue, normalizeValue, knobValue[0],
                                                    knobValue[1], knobValue[2]);
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
    cab_.prepare({sampleRate_, (juce::uint32)juce::jmax(1, blockSize_), 1});
    // A model may already be loaded: EditBuilder loads one right after construction, so this order is not fixed.
    prepareBridge();
}

bool NamPlugin::needsBridge(double model) const
{
    return model > 0.0 && std::abs(model - sampleRate_) > 1.0;
}

void NamPlugin::logBridge(double model) const
{
    // The delay the lane now carries, which Tracktion compensates — said so it can be read, not guessed.
    std::cerr << "[nam] " << model << " Hz model on a " << sampleRate_ << " Hz engine: +"
              << bridge_.latencySamples() << " samples ("
              << juce::String(1000.0 * bridge_.latencySamples() / sampleRate_, 2) << " ms)\n";
}

void NamPlugin::prepareBridge()
{
    const double model = modelRate_.load(std::memory_order_relaxed);
    bool bridge = false;
    {
        const juce::SpinLock::ScopedLockType sl(lock_);
        bridge = dsp_ != nullptr && needsBridge(model);
        if (bridge) bridge_.prepare(sampleRate_, model, BRIDGE_BLOCK, 1, 1, *this);
        bridged_.store(bridge, std::memory_order_relaxed);
        // The model is clocked at the rate it RUNS at, and fed one fixed block at a time when bridged; a rate change has to re-prepare the live one.
        if (dsp_ != nullptr)
            dsp_->reset(bridge ? model : sampleRate_, bridge ? BRIDGE_BLOCK : blockSize_);   // prewarms
    }
    if (bridge) logBridge(model);
}

void NamPlugin::renderBlock(const float* const* in, float* const* out)
{
    // In place on the output: NAM allows it, and the input pointer is the bridge's own buffer, const.
    juce::FloatVectorOperations::copy(out[0], in[0], BRIDGE_BLOCK);
    dsp_->process(out[0], BRIDGE_BLOCK);
}

double NamPlugin::getLatencySeconds()
{
    if (sampleRate_ <= 0.0) return 0.0;
    const int bridge = bridged_.load(std::memory_order_relaxed) ? bridge_.latencySamples() : 0;
    const int cab = hasIr_.load(std::memory_order_relaxed) ? cab_.getLatency() : 0;
    return (bridge + cab) / sampleRate_;
}

bool NamPlugin::loadImpulseResponse(const juce::File& file, juce::String& error)
{
    if (!file.existsAsFile()) {
        error = "no such IR: " + file.getFullPathName();
        return false;
    }
    juce::AudioFormatManager formats;
    formats.registerBasicFormats();
    std::unique_ptr<juce::AudioFormatReader> reader(formats.createReaderFor(file));
    if (reader == nullptr || reader->lengthInSamples <= 0) {
        error = "not a readable IR: " + file.getFullPathName();
        return false;
    }
    // Mono like the model: the first channel.
    juce::AudioBuffer<float> ir(1, (int)reader->lengthInSamples);
    reader->read(&ir, 0, ir.getNumSamples(), 0, true, false);

    // UNIT energy, so a cab is its shape and not its level — JUCE's own Normalise aims far lower (docs/namPlugin.md).
    const float* x = ir.getReadPointer(0);
    double energy = 0.0;
    for (int i = 0; i < ir.getNumSamples(); ++i) energy += (double)x[i] * x[i];
    if (energy > 1.0e-8) ir.applyGain((float)(1.0 / std::sqrt(energy)));

    // Trimmed of its leading silence, and resampled by JUCE to the engine's rate.
    cab_.loadImpulseResponse(std::move(ir), reader->sampleRate, juce::dsp::Convolution::Stereo::no,
                             juce::dsp::Convolution::Trim::yes, juce::dsp::Convolution::Normalise::no);
    hasIr_.store(true, std::memory_order_relaxed);
    return true;
}

void NamPlugin::deinitialise() {}

void NamPlugin::reset()
{
    // Under the lock the audio thread try-locks around cab_.process(): a Convolution reset mid-process is a torn state.
    const juce::SpinLock::ScopedLockType sl(lock_);
    cab_.reset();
    const bool bridge = bridged_.load(std::memory_order_relaxed);
    if (bridge) bridge_.reset();
    if (dsp_ != nullptr)
        dsp_->reset(bridge ? modelRate_.load(std::memory_order_relaxed) : sampleRate_,
                    bridge ? BRIDGE_BLOCK : blockSize_);   // prewarms by default
}

juce::String NamPlugin::modelPath() const
{
    const juce::SpinLock::ScopedLockType sl(const_cast<juce::SpinLock&>(lock_));
    return path_;
}

bool NamPlugin::modelIsNam() const
{
    return modelPath().endsWithIgnoreCase(".nam");
}

bool NamPlugin::loadModel(const juce::File& file, juce::String& error)
{
    if (!file.existsAsFile()) {
        error = "no such file: " + file.getFullPathName();
        return false;
    }

    // Built OUTSIDE the lock, so the audio thread waits for a pointer assignment and never for a model load.
    std::string why;
    std::unique_ptr<AmpModel> loaded = loadAmpModel(file.getFullPathName().toStdString(), why);
    if (loaded == nullptr) {
        error = juce::String(why);
        return false;
    }

    const double rate = loaded->sampleRate();
    // Read BEFORE the move: only a .nam declares one.
    const auto declared = loaded->loudness();
    const bool hasLoudness = declared.has_value();
    const double loudness = declared.value_or(0.0);
    const int knobs = loaded->knobs();

    // Prewarmed HERE, on a model nothing else can see yet: the prewarm is the costly part, and under the lock it would pass the guitar dry.
    const bool bridge = needsBridge(rate);
    float where[AmpModel::MAX_KNOBS];
    for (int k = 0; k < AmpModel::MAX_KNOBS; ++k) where[k] = knob[k]->getCurrentValue();
    loaded->setKnobs(where);
    loaded->reset(bridge ? rate : sampleRate_, bridge ? BRIDGE_BLOCK : blockSize_);
    std::cerr << "[nam] " << file.getFileName() << ": " << loaded->describe() << ", " << rate << " Hz, "
              << knobs << " knob(s)\n";
    {
        const juce::SpinLock::ScopedLockType sl(lock_);
        // Swapped rather than assigned, so the OLD model is freed after the lock, not inside it.
        std::swap(dsp_, loaded);
        path_ = file.getFullPathName();
        modelRate_.store(rate, std::memory_order_relaxed);
        modelKnobs_.store(knobs, std::memory_order_relaxed);
        if (bridge) bridge_.prepare(sampleRate_, rate, BRIDGE_BLOCK, 1, 1, *this);
        bridged_.store(bridge, std::memory_order_relaxed);
    }
    loaded.reset();
    if (bridge) logBridge(rate);
    // Published after the swap, in this order: a new model normalized by the OLD loudness is the failure to avoid.
    loudnessDb_.store(loudness, std::memory_order_relaxed);
    hasLoudness_.store(hasLoudness, std::memory_order_relaxed);
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
    // Where the knobs are heading; the model glides to them per sample, across chunks and the bridge alike.
    float knobs[AmpModel::MAX_KNOBS];
    for (int k = 0; k < AmpModel::MAX_KNOBS; ++k) knobs[k] = knob[k]->getCurrentValue();
    dsp_->setKnobs(knobs);

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
        if (bridged_.load(std::memory_order_relaxed)) {
            const float* ins[1] = {in};
            bridge_.run(ins, &out, n);   // reads all of `in` before it writes `out`, so in place holds
        } else {
            dsp_->process(out, n);
        }

        // The cabinet after the amp, at the engine's rate: JUCE resampled the IR to it when it loaded.
        if (hasIr_.load(std::memory_order_relaxed)) {
            float* chans[1] = {out};
            juce::dsp::AudioBlock<float> block(chans, 1, (size_t)n);
            cab_.process(juce::dsp::ProcessContextReplacing<float>(block));
        }

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
