#include "SurgePlugin.h"

#include "surge/SurgeCore.h"

#include <cmath>
#include <iostream>

namespace studio {

// Renaming this renames the id a module.yaml may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* SurgePlugin::xmlTypeName = "studio_surge";

namespace {

// The volume's range in dB, the same as an SFZ instrument's: a level to sit it in a mix, not a fader.
constexpr float VOLUME_MIN_DB = -40.0f;
constexpr float VOLUME_MAX_DB = 12.0f;

// How often the parameters are read back off the synth: a type change shows on its slots this soon.
constexpr int READ_BACK_HZ = 10;

// Below this the synth and a parameter agree: a value round-tripped through Surge's 0..1 is not bit-exact.
constexpr float AGREE = 1e-5f;

juce::String dbToText(float v) { return juce::String(v, 1) + " dB"; }
float textToDb(const juce::String& s) { return s.getFloatValue(); }

}  // namespace

SurgePlugin::SurgePlugin(tracktion::engine::PluginCreationInfo info)
    : Plugin(std::move(info))
{
    auto* um = getUndoManager();
    volumeDbValue.referTo(state, juce::Identifier("volume"), um, 0.0f);
    volumeDb = addParam("volume", "Volume", {VOLUME_MIN_DB, VOLUME_MAX_DB}, dbToText, textToDb);
    volumeDb->attachToCurrentValue(volumeDbValue);

    // Surge's Init patch until a module names one, so an instrument with no patch still sounds.
    core_ = std::make_unique<surge::SurgeCore>(sampleRate_);
    const auto& list = surge::SurgeCore::params();
    agreed_ = std::make_unique<std::atomic<float>[]>(list.size());
    heard_ = std::make_unique<std::atomic<float>[]>(list.size());
    heardAgreed_ = std::make_unique<std::atomic<float>[]>(list.size());
    for (size_t i = 0; i < list.size(); ++i) {
        const auto& p = list[i];
        auto value = std::make_unique<juce::CachedValue<float>>();
        // No undo manager: a patch load writes every one of them, and the read-back follows the synth on its own.
        value->referTo(state, juce::Identifier(p.id), nullptr, p.def);
        // Surge's own words for a value, read off the live synth, so a slot reads as what its type makes it.
        auto toText = [this, i](float v) {
            return juce::String(core_ != nullptr ? core_->display((int)i, v) : std::string{});
        };
        juce::NormalisableRange<float> range(p.min, p.max);
        if (p.discrete) range.interval = 1.0f;
        auto param = addParam(p.id, p.name, range, toText, [](const juce::String& s) { return s.getFloatValue(); });
        param->attachToCurrentValue(*value);
        params_.push_back(param);
        values_.push_back(std::move(value));
        agreed_[i] = core_->get((int)i);
    }
    startTimerHz(READ_BACK_HZ);
}

SurgePlugin::~SurgePlugin()
{
    stopTimer();
    notifyListenersOfDeletion();
    volumeDb->detachFromCurrentValue();
    for (auto& p : params_) p->detachFromCurrentValue();
}

void SurgePlugin::restorePluginStateFromValueTree(const juce::ValueTree& v)
{
    tracktion::engine::copyPropertiesToCachedValues(v, volumeDbValue);
    for (auto& value : values_) tracktion::engine::copyPropertiesToCachedValues(v, *value);
    for (auto p : getAutomatableParameters())
        p->updateFromAttachedValue();
}

juce::ValueTree SurgePlugin::create()
{
    juce::ValueTree v(tracktion::engine::IDs::PLUGIN);
    v.setProperty(tracktion::engine::IDs::type, xmlTypeName, nullptr);
    return v;
}

void SurgePlugin::initialise(const tracktion::engine::PluginInitialisationInfo& info)
{
    sampleRate_ = info.sampleRate;
    const juce::SpinLock::ScopedLockType sl(lock_);
    if (core_ != nullptr) core_->setSampleRate(sampleRate_);
}

void SurgePlugin::deinitialise() {}

void SurgePlugin::reset()
{
    silencePending_ = true;
}

void SurgePlugin::midiPanic()
{
    silencePending_ = true;
}

bool SurgePlugin::loadPatch(const juce::String& path, juce::String& error)
{
    const juce::File file(path);
    if (!file.existsAsFile()) {
        error = "surge patch not found: " + path;
        return false;
    }
    // Built and loaded OFF the lock: a synth's construction and a patch's parse are milliseconds each.
    auto fresh = std::make_unique<surge::SurgeCore>(sampleRate_);
    std::string err;
    if (!fresh->loadPatch(file.getFullPathName().toStdString(), err)) {
        error = err;
        return false;
    }
    std::cerr << "[surge] " << file.getFileName() << ": " << fresh->patchName() << "\n";
    swapIn(std::move(fresh));
    return true;
}

void SurgePlugin::swapIn(std::unique_ptr<surge::SurgeCore> fresh)
{
    // The patch's values become the parameters'; the module's own go back on top after (EditBuilder, EngineHost).
    const size_t n = params_.size();
    std::vector<float> patch(n);
    for (size_t i = 0; i < n; ++i) patch[i] = fresh->get((int)i);
    {
        const juce::SpinLock::ScopedLockType sl(lock_);
        std::swap(core_, fresh);
        for (size_t i = 0; i < n; ++i) agreed_[i] = patch[i];
        pos_ = surge::SurgeCore::block();
        // A snapshot of the previous synth must not be read back onto the new one's parameters.
        readBack_.store(kIdle, std::memory_order_release);
    }
    for (size_t i = 0; i < n; ++i) params_[i]->setParameter(patch[i], juce::sendNotification);
    // The previous synth dies here, on the message thread, never on the audio one.
}

void SurgePlugin::timerCallback()
{
    // The synth is the audio thread's while it renders, so the timer reads only what that thread published.
    if (readBack_.load(std::memory_order_acquire) == kPublished) {
        for (size_t i = 0; i < params_.size(); ++i) {
            const float synth = heard_[i].load(std::memory_order_relaxed);
            const float then = heardAgreed_[i].load(std::memory_order_relaxed);
            const float now = agreed_[i].load();
            // The synth moved by itself — a type change resetting slots — and neither a push nor a touch came since.
            if (std::abs(synth - then) > AGREE && std::abs(now - then) <= AGREE
                && std::abs(params_[i]->getCurrentValue() - now) <= AGREE) {
                agreed_[i] = synth;
                params_[i]->setParameter(synth, juce::sendNotification);
            }
        }
    }
    readBack_.store(kAsked, std::memory_order_release);
}

void SurgePlugin::applyToBuffer(const tracktion::engine::PluginRenderContext& ctx)
{
    if (ctx.destBuffer == nullptr) return;
    const int n = ctx.bufferNumSamples;
    const int start = ctx.bufferStartSample;
    const int chans = juce::jmin(ctx.destBuffer->getNumChannels(), 2);
    // An instrument: whatever the track carried in is replaced, by the synth or by silence.
    for (int c = 0; c < ctx.destBuffer->getNumChannels(); ++c) ctx.destBuffer->clear(c, start, n);

    const juce::SpinLock::ScopedTryLockType sl(lock_);
    if (!sl.isLocked() || core_ == nullptr || n <= 0) return;
    auto& core = *core_;

    if (silencePending_.exchange(false)) core.allSoundOff();
    // A parameter moved past what the synth holds — a knob, automation, the module's file — goes to the synth.
    for (size_t i = 0; i < params_.size(); ++i) {
        const float v = params_[i]->getCurrentValue();
        if (std::abs(v - agreed_[i].load(std::memory_order_relaxed)) > AGREE) {
            core.set((int)i, v);
            agreed_[i].store(v, std::memory_order_relaxed);
        }
    }

    // Surge renders fixed blocks: each event is played before the block that follows it, at most one block late.
    const int block = surge::SurgeCore::block();
    const double rate = sampleRate > 0.0 ? sampleRate : sampleRate_;
    const float gain = juce::Decibels::decibelsToGain(volumeDbValue.get());
    auto it = ctx.bufferForMidiMessages != nullptr ? ctx.bufferForMidiMessages->begin() : nullptr;
    const auto end = ctx.bufferForMidiMessages != nullptr ? ctx.bufferForMidiMessages->end() : nullptr;
    // Every message due by sample `upTo` goes to the synth, in order.
    const auto dispatch = [&](int upTo) {
        for (; it != end; ++it) {
            const int at = juce::jlimit(0, n - 1, (int)((it->getTimeStamp() - ctx.midiBufferOffset) * rate));
            if (at > upTo) break;
            const auto& m = *it;
            const int ch = m.getChannel() - 1;
            if (m.isNoteOn()) core.noteOn(ch, m.getNoteNumber(), m.getVelocity());
            else if (m.isNoteOff()) core.noteOff(ch, m.getNoteNumber(), m.getVelocity());
            else if (m.isAllNotesOff() || m.isAllSoundOff()) core.allSoundOff();
            else if (m.isController()) core.controller(ch, m.getControllerNumber(), m.getControllerValue());
            else if (m.isPitchWheel()) core.pitchBend(ch, m.getPitchWheelValue() - 8192);
            else if (m.isChannelPressure()) core.channelPressure(ch, m.getChannelPressureValue());
            else if (m.isAftertouch()) core.polyPressure(ch, m.getNoteNumber(), m.getAfterTouchValue());
        }
    };
    float* outL = ctx.destBuffer->getWritePointer(0, start);
    float* outR = chans > 1 ? ctx.destBuffer->getWritePointer(1, start) : nullptr;
    for (int done = 0; done < n;) {
        if (pos_ >= block) {
            dispatch(done);
            core.render();
            pos_ = 0;
        }
        const int len = juce::jmin(block - pos_, n - done);
        const float* l = core.left() + pos_;
        const float* r = core.right() + pos_;
        for (int k = 0; k < len; ++k) {
            outL[done + k] = l[k] * gain;
            if (outR != nullptr) outR[done + k] = r[k] * gain;
        }
        pos_ += len;
        done += len;
    }
    // What falls after this buffer's last block boundary is played by the next block, never dropped.
    dispatch(n);

    // Asked for by the timer, at most READ_BACK_HZ times a second: the synth's values, read where it is safe to.
    if (readBack_.load(std::memory_order_acquire) == kAsked) {
        for (size_t i = 0; i < params_.size(); ++i) {
            heard_[i].store(core.get((int)i), std::memory_order_relaxed);
            heardAgreed_[i].store(agreed_[i].load(std::memory_order_relaxed), std::memory_order_relaxed);
        }
        readBack_.store(kPublished, std::memory_order_release);
    }
}

}  // namespace studio
