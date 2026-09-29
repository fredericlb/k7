#include "TurntablePlugin.h"
#include "RecordSource.h"   // a record mapped, never held in private memory
#include "Warnings.h"   // a decode failing on the loader thread still reaches the client

#include <algorithm>
#include <cstring>
#include <iostream>

namespace studio {

namespace te = tracktion::engine;

// Renaming this renames the id a module.yaml may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* TurntablePlugin::xmlTypeName = "studio_turntable";

namespace {
/** How fast a platter may be driven either way. Four is a hard shove; beyond it nothing is a pitch. */
constexpr float rateMin = -4.0f, rateMax = 4.0f;

/** How long the rate takes to reach what was asked, in seconds.
 *
 * A hand's positions arrive at 60 Hz and the audio runs at 48 kHz, so a rate stepped per message is
 * a staircase and every step is a click. Six milliseconds is short enough to feel immediate and long
 * enough to round the corner — see docs/turntable.md. */
constexpr double rateGlideSeconds = 0.006;

/** Below this a platter is STOPPED, and a stopped platter is silent — a held sample would be a DC step. */
constexpr double stopRate = 1.0e-4;

/** The band the stretcher covers. Outside it — backwards, stopped, or a hard shove — the varispeed answers. */
constexpr float stretchRateMin = 0.1f;

/** Four-point Hermite, the interpolation a scratch needs: linear aliases audibly once the rate moves. */
inline float hermite(float xm1, float x0, float x1, float x2, double t)
{
    const auto c = (x1 - xm1) * 0.5f;
    const auto v = x0 - x1;
    const auto w = c + v;
    const auto a = w + v + (x2 - x0) * 0.5f;
    const auto b = w + a;
    const auto tt = static_cast<float>(t);
    return ((((a * tt) - b) * tt + c) * tt) + x0;
}
}  // namespace

TurntablePlugin::TurntablePlugin(te::PluginCreationInfo info) : Plugin(std::move(info))
{
    auto* um = getUndoManager();
    const auto add = [&](const char* id, const char* name, float lo, float hi,
                         float def) -> te::AutomatableParameter::Ptr {
        auto value = std::make_unique<juce::CachedValue<float>>();
        value->referTo(state, juce::Identifier(juce::String("p_") + name), um, def);
        auto param = addParam(id, name, {lo, hi});
        param->attachToCurrentValue(*value);
        values_.push_back(std::move(value));
        return param;
    };

    // The platter's SPEED, not its position: a hand on a record imparts a velocity, and reverse is a sign.
    rate_p_ = add("rate", "Rate", rateMin, rateMax, 0.0f);
    // …and where to drop the needle, 0..1 of the record. A jump, applied only when the value CHANGES.
    seek_p_ = add("seek", "Seek", 0.0f, 1.0f, 0.0f);
    gain_p_ = add("gain", "Gain", 0.0f, 2.0f, 1.0f);
    // Hold the PITCH while the rate moves. Off by default: a platter is a varispeed, and that is its sound.
    key_p_ = add("key", "Key", 0.0f, 1.0f, 0.0f);
    // The loop's two edges, 0..1 of the record like `Seek`. OFF is `End <= Start`, which is the rest state.
    loopStart_p_ = add("loopStart", "LoopStart", 0.0f, 1.0f, 0.0f);
    loopEnd_p_ = add("loopEnd", "LoopEnd", 0.0f, 1.0f, 0.0f);
    // Is the NEXT loop momentary? Read when the loop engages and never again — see TurntableLoop::aim.
    roll_p_ = add("roll", "Roll", 0.0f, 1.0f, 0.0f);
}

TurntablePlugin::~TurntablePlugin()
{
    // A decode in flight writes into this plugin, so it is waited for; one not started is dropped.
    loader_.removeAllJobs(true, -1);
    notifyListenersOfDeletion();
    for (auto* p : {rate_p_.get(), seek_p_.get(), gain_p_.get(), key_p_.get(),
                    loopStart_p_.get(), loopEnd_p_.get(), roll_p_.get()})
        if (p != nullptr) p->detachFromCurrentValue();
}

void TurntablePlugin::restorePluginStateFromValueTree(const juce::ValueTree& v)
{
    for (auto& value : values_)
        if (auto* p = v.getPropertyPointer(value->getPropertyID()))
            *value = static_cast<float>(*p);
        else
            value->resetToDefault();
    for (auto p : getAutomatableParameters())
        p->updateFromAttachedValue();
}

bool TurntablePlugin::loadRecordAsync(const juce::File& file, juce::String& error, const std::string& subject)
{
    if (!file.existsAsFile()) {
        error = "no such file: " + file.getFullPathName();
        return false;
    }
    {
        juce::AudioFormatManager afm;
        afm.registerBasicFormats();
        if (std::unique_ptr<juce::AudioFormatReader> header{afm.createReaderFor(file)}; header == nullptr) {
            error = "cannot decode " + file.getFileName();
            return false;
        }
    }
    const int gen = ++loadGen_;
    ++loadsPending_;
    loader_.addJob([this, file, gen, subject] {
        // A later request superseded this one before it started: nothing to decode.
        if (gen == loadGen_.load()) {
            juce::String err;
            if (!loadRecord(file, err, gen)) warn(err.toStdString(), subject);
        }
        --loadsPending_;
    });
    return true;
}

bool TurntablePlugin::loadRecord(const juce::File& file, juce::String& error)
{
    return loadRecord(file, error, 0);
}

bool TurntablePlugin::loadRecord(const juce::File& file, juce::String& error, int gen)
{
    if (!file.existsAsFile()) {
        error = "no such file: " + file.getFullPathName();
        return false;
    }
    juce::AudioFormatManager afm;
    afm.registerBasicFormats();
    std::unique_ptr<juce::AudioFormatReader> reader{afm.createReaderFor(file)};
    if (reader == nullptr) {
        error = "cannot decode " + file.getFileName();
        return false;
    }
    const double loadT0 = juce::Time::getMillisecondCounterHiRes();
    // std::min, not juce::jmin<juce::int64>: juce_dsp's SIMDRegister overload of jmin fails on Linux, where int64_t is not long long.
    auto frames = static_cast<int>(std::min<juce::int64>(
        reader->lengthInSamples, std::numeric_limits<int>::max()));
    std::vector<int16_t> packed;
    float scale = 1.0f;

    // MAPPED, the ordinary case: a WAV read where it lies, anything else decoded once into the record cache (RecordSource.h).
    juce::String how = "decoded";
    auto mapped = openRecord(file, how);
    if (mapped) frames = mapped->frames;

    if (mapped) {
        // Nothing to pack: the mapping is the record.
    } else if (!reader->usesFloatingPointData) {
        packed.resize(static_cast<size_t>(juce::jmax(1, frames)) * 2);
        // The DIRECT path, and the common one — a record off the médiathèque is an integer file.
        // Reading it as int is the reader's own format, so there is no conversion anywhere: no float
        // buffer, no second pass, and no peak scan, an integer file having no headroom to find.
        // Read in BLOCKS through a scratch that stays in cache, rather than into two full-length
        // int32 vectors: a whole record's worth of scratch is 8 MB a channel and is touched twice.
        constexpr int chunk = 1 << 16;
        std::vector<int> left(chunk, 0);
        std::vector<int> right(chunk, 0);
        int* channels[2] = {left.data(), right.data()};
        const bool mono = reader->numChannels == 1;
        for (int at = 0; at < frames; at += chunk) {
            const auto n = juce::jmin(chunk, frames - at);
            reader->read(channels, 2, at, n, true);
            // JUCE normalises an integer read to the top of int32, so the 16 high bits ARE the sample.
            for (int i = 0; i < n; ++i) {
                const auto k = static_cast<size_t>(at + i) * 2;
                packed[k] = static_cast<int16_t>(left[static_cast<size_t>(i)] >> 16);
                // A mono record plays out of both, rather than out of the left only.
                packed[k + 1] = static_cast<int16_t>(
                    (mono ? left[static_cast<size_t>(i)] : right[static_cast<size_t>(i)]) >> 16);
            }
        }
    } else {
        // A FLOAT wav — which every stem is — may sit above 1, so the peak has to be known before
        // anything is packed. That costs a float buffer and a second pass, and it dies with this scope.
        packed.resize(static_cast<size_t>(juce::jmax(1, frames)) * 2);
        juce::AudioBuffer<float> decoded{2, juce::jmax(1, frames)};
        decoded.clear();
        reader->read(&decoded, 0, frames, 0, true, reader->numChannels > 1);
        if (reader->numChannels == 1) decoded.copyFrom(1, 0, decoded, 0, 0, frames);
        const auto peak = juce::jmax(decoded.getMagnitude(0, 0, frames),
                                     decoded.getMagnitude(1, 0, frames));
        // Only ever scales DOWN: a quiet record keeps its level, nothing is normalised behind anyone's back.
        scale = peak > 1.0f ? peak : 1.0f;
        const auto* l = decoded.getReadPointer(0);
        const auto* r = decoded.getReadPointer(1);
        for (int i = 0; i < frames; ++i) {
            packed[static_cast<size_t>(i) * 2] =
                static_cast<int16_t>(juce::jlimit(-32768.0f, 32767.0f, (l[i] / scale) * 32767.0f));
            packed[static_cast<size_t>(i) * 2 + 1] =
                static_cast<int16_t>(juce::jlimit(-32768.0f, 32767.0f, (r[i] / scale) * 32767.0f));
        }
    }

    // Which path and how long, since a record that decodes rather than maps costs seconds and memory, and nothing else says so.
    std::cerr << "[deck] " << file.getFileName() << ": " << how << " in "
              << (juce::Time::getMillisecondCounterHiRes() - loadT0) << " ms\n";
    const juce::SpinLock::ScopedLockType lock{recordLock_};
    // A decode finishing after a LATER request was made is not what the deck should play.
    if (gen != 0 && gen != loadGen_.load()) return true;
    // Swapped, so the OLD record — hundreds of MB, or a mapping — is freed with `packed` and `map` after the lock, not while the audio thread waits on it.
    record_.swap(packed);
    std::unique_ptr<juce::MemoryMappedFile> map = mapped ? std::move(mapped->map) : nullptr;
    mapped_.swap(map);
    pcm_ = mapped ? mapped->pcm : reinterpret_cast<const unsigned char*>(record_.data());
    bytesPerSample_ = mapped ? mapped->width : 2;
    isFloat_ = mapped && mapped->isFloat;
    channels_ = mapped ? mapped->channels : 2;
    // Full scale is the stored format's: a float is its own, a 24-bit integer worth 256 times a 16-bit one.
    scale_ = isFloat_ ? 1.0f : scale / (bytesPerSample_ == 3 ? 8388607.0f : 32767.0f);
    frames_ = frames;
    recordRate_ = mapped ? mapped->sampleRate : reader->sampleRate;
    position_ = 0.0;
    rate_ = 0.0;
    return true;
}

double TurntablePlugin::recordSeconds() const
{
    return recordRate_ > 0.0 ? frames_ / recordRate_ : 0.0;
}

void TurntablePlugin::initialise(const te::PluginInitialisationInfo& info)
{
    // An unlinked mode silently becomes `disabled`, so ASK rather than name one — see EditBuilder's warp.
    const auto mode = te::TimeStretcher::checkModeIsAvailable(te::TimeStretcher::elastiquePro);
    if (mode == te::TimeStretcher::disabled) return;
    // Elastique refuses blocks over 1024, and a smaller one is less audio to throw away on a jump.
    const auto block = juce::jlimit(64, 1024, info.blockSizeSamples);
    stretcher_.initialise(info.sampleRate, block, 2, mode, {}, true);
    stretchIn_.setSize(2, juce::jmax(block, stretcher_.getMaxFramesNeeded()));
    stretchOut_.setSize(2, block);
    reset();
}

void TurntablePlugin::deinitialise() {}

void TurntablePlugin::reset()
{
    resetPending_ = true;
}

void TurntablePlugin::clearState()
{
    rate_ = 0.0;
    lastGain_ = -1.0f;
    stretchReady_ = stretchRead_ = 0;
    stretching_ = false;
    // Dropped rather than kept: the next block re-aims it from the params, latching the roll afresh.
    loop_ = {};
}

void TurntablePlugin::frameAt(double pos, float& left, float& right) const
{
    const auto* pcm = pcm_;
    const auto width = bytesPerSample_;
    const auto channels = channels_;
    const auto i0 = static_cast<int>(pos);
    const auto t = pos - i0;
    // Interleaved, 16- or 24-bit or float, one or two channels: one read is a load and a shift, the scale riding on the gain — docs/turntable.md.
    const auto at = [&](int k, int ch) {
        const auto frame = static_cast<size_t>(juce::jlimit(0, frames_ - 1, k));
        const auto* p = pcm + (frame * static_cast<size_t>(channels) + (channels == 2 ? ch : 0)) * width;
        if (width == 2) {
            int16_t v;
            std::memcpy(&v, p, 2);
            return static_cast<float>(v);
        }
        if (width == 4) {
            float v;
            std::memcpy(&v, p, 4);
            return v;
        }
        return static_cast<float>(static_cast<int>(p[0]) | (static_cast<int>(p[1]) << 8) |
                                  (static_cast<int>(static_cast<signed char>(p[2])) << 16));
    };
    left = hermite(at(i0 - 1, 0), at(i0, 0), at(i0 + 1, 0), at(i0 + 2, 0), t);
    right = hermite(at(i0 - 1, 1), at(i0, 1), at(i0 + 1, 1), at(i0 + 2, 1), t);
}

int TurntablePlugin::readNatural(float* left, float* right, int n)
{
    // The stretcher is handed the record at its OWN speed: only the device's rate is corrected here.
    const auto step = recordRate_ / juce::jmax(1.0, sampleRate);
    // A looping record never runs out, so the end of it stops being the end of this read.
    const auto looping = loop_.active();
    int done = 0;
    for (; done < n && (looping || position_ <= frames_ - 1); ++done) {
        frameAt(juce::jmax(0.0, position_), left[done], right[done]);
        position_ += step;
        // `wrap`, not `step`: the shadow follows what is HEARD, and this read is ahead of it.
        if (looping) position_ = loop_.wrap(position_);
    }
    return done;
}

void TurntablePlugin::renderStretched(float* outL, float* outR, int start, int n, float rate, float g)
{
    // 1 is as recorded and 2 is half as fast, so what a stretcher wants is the INVERSE of a rate.
    const auto ratio = 1.0f / rate;
    // What one output frame costs in RECORD samples: the rate, and the device's own conversion.
    const auto perFrame = rate * (recordRate_ / juce::jmax(1.0, sampleRate));
    // Entering the stretched path on stale state would play the place the record was BEFORE the jump.
    if (!stretching_) {
        stretcher_.reset();
        stretchReady_ = stretchRead_ = 0;
        owed_ = 0.0;
        lastRatio_ = 0.0f;
        stretching_ = true;
    }
    if (ratio != lastRatio_) {
        stretcher_.setSpeedAndPitch(ratio, 0.0f);
        lastRatio_ = ratio;
    }
    auto* inL = stretchIn_.getWritePointer(0);
    auto* inR = stretchIn_.getWritePointer(1);
    auto* midL = stretchOut_.getWritePointer(0);
    auto* midR = stretchOut_.getWritePointer(1);
    const float* ins[2] = {inL, inR};
    float* mids[2] = {midL, midR};

    int done = 0;
    // Bounded: an algorithm that hands nothing back must not spin the audio thread.
    for (int guard = 0; done < n && guard < 64; ++guard) {
        if (stretchRead_ < stretchReady_) {
            const auto take = juce::jmin(n - done, stretchReady_ - stretchRead_);
            for (int i = 0; i < take; ++i) {
                outL[start + done + i] += midL[stretchRead_ + i] * g;
                if (outR != nullptr) outR[start + done + i] += midR[stretchRead_ + i] * g;
            }
            done += take;
            stretchRead_ += take;
            // What came out is no longer read AHEAD, so the needle catches up by exactly that much.
            owed_ = juce::jmax(0.0, owed_ - take * perFrame);
            continue;
        }
        const auto needed = juce::jmin(stretcher_.getFramesNeeded(), stretchIn_.getNumSamples());
        // A negative ask is the end of a stream, which a platter reaches only at the end of its record.
        if (needed < 0) break;
        const auto got = readNatural(inL, inR, needed);
        // Only the RECORD running out ends a block early: an algorithm priming still owes us audio.
        if (got <= 0 && needed > 0) break;
        // Counted from the frames READ and not from where position_ ended: a loop wraps it backwards.
        owed_ += got * (recordRate_ / juce::jmax(1.0, sampleRate));
        juce::FloatVectorOperations::clear(inL + got, needed - got);
        juce::FloatVectorOperations::clear(inR + got, needed - got);
        stretchReady_ = stretcher_.processData(ins, needed, mids);
        stretchRead_ = 0;
    }
    // The shadow follows what came OUT, since that is what a roll's release has to hand back.
    loop_.carry(done * perFrame);
}

void TurntablePlugin::applyToBuffer(const te::PluginRenderContext& fc)
{
    // An offline render has no one to hear a late record: it waits for the decode, which runs on its own thread.
    if (fc.isRendering)
        while (loadsPending_.load() > 0) juce::Thread::sleep(5);
    if (fc.destBuffer == nullptr) return;
    if (resetPending_.exchange(false)) clearState();
    const auto n = fc.bufferNumSamples;
    const auto start = fc.bufferStartSample;
    const auto outs = fc.destBuffer->getNumChannels();
    for (int ch = 0; ch < outs; ++ch)
        fc.destBuffer->clear(ch, start, n);

    // Never blocks the audio thread: a load in flight simply means this block is silence.
    const juce::SpinLock::ScopedTryLockType lock{recordLock_};
    if (!lock.isLocked()) return;

    const auto frames = frames_;
    if (frames <= 0 || recordRate_ <= 0.0) return;

    // A record cut at 44.1 played out of a 48 k device runs at a ratio, exactly as a clip would.
    const auto resample = recordRate_ / juce::jmax(1.0, sampleRate);
    const auto wanted = static_cast<double>(rate_p_->getCurrentValue()) * resample;

    // A CHANGED seek is a needle-drop; the same value arriving again is not, a param being a level.
    const auto seek = seek_p_->getCurrentValue();
    if (seek != lastSeek_) {
        lastSeek_ = seek;
        position_ = juce::jlimit(0.0, static_cast<double>(frames - 1),
                                 static_cast<double>(seek) * frames);
        // The stretcher still holds audio from before the jump, and it is no longer where the record is.
        stretching_ = false;
    }

    // AFTER the seek: a needle dropped while a loop is open belongs inside it, not beside it.
    // Over `frames - 1` and not `frames` as Seek is: an edge ON the last sample would meet the
    // end-of-record stop below and hang there instead of wrapping.
    const auto span = static_cast<double>(frames - 1);
    const auto aimed = loop_.aim(loopStart_p_->getCurrentValue() * span,
                                 loopEnd_p_->getCurrentValue() * span,
                                 roll_p_->getCurrentValue() >= 0.5f, position_);
    if (aimed != position_) {
        position_ = juce::jlimit(0.0, span, aimed);
        // A roll's release is a jump like any other, and the stretcher holds the wrong place.
        stretching_ = false;
    }

    // The record's own scale per point; the GAIN is ramped over the finished block, the buffer holding this deck alone (cleared above).
    const auto g = scale_;
    const float gainNow = gain_p_->getCurrentValue();
    const auto rampGain = [&] {
        const float from = lastGain_ < 0.0f ? gainNow : lastGain_;
        for (int ch = 0; ch < juce::jmin(outs, 2); ++ch) fc.destBuffer->applyGainRamp(ch, start, n, from, gainNow);
        lastGain_ = gainNow;
    };
    auto* outL = fc.destBuffer->getWritePointer(0);
    auto* outR = outs > 1 ? fc.destBuffer->getWritePointer(1) : nullptr;

    // KEY holds the pitch, but only where an algorithm can: forwards, and not stopped. See docs/turntable.md.
    const auto asked = rate_p_->getCurrentValue();
    if (key_p_->getCurrentValue() >= 0.5f && stretcher_.isInitialised()
        && asked >= stretchRateMin && asked <= rateMax) {
        renderStretched(outL, outR, start, n, asked, g);
        // The varispeed resumes from here rather than from wherever it was left when KEY came on.
        rate_ = wanted;
        // The needle says what is HEARD, so the read-ahead comes off: a cue is dropped on this number.
        // Wrapped as well, the read-ahead having crossed an edge the heard position has not yet.
        needle_.store(loop_.wrap(position_ - owed_) / recordRate_, std::memory_order_relaxed);
        rampGain();
        return;
    }
    stretching_ = false;
    owed_ = 0.0;

    // One-pole toward the asked-for rate, per SAMPLE — the corner a 60 Hz message stream leaves behind.
    const auto glide = 1.0 - std::exp(-1.0 / juce::jmax(1.0, sampleRate * rateGlideSeconds));
    for (int i = 0; i < n; ++i) {
        rate_ += (wanted - rate_) * glide;
        // Stopped at an end rather than wrapped: a record has two of them, and neither is the other.
        if (position_ < 0.0 || position_ > frames - 1) {
            position_ = juce::jlimit(0.0, static_cast<double>(frames - 1), position_);
            if ((position_ <= 0.0 && rate_ < 0.0) || (position_ >= frames - 1 && rate_ > 0.0))
                continue;
        }
        // A platter at rest is SILENT: a needle frozen on one sample would put a DC step on the bus.
        if (std::abs(rate_) < stopRate) continue;
        float l = 0.0f, r = 0.0f;
        frameAt(position_, l, r);
        outL[start + i] += l * g;
        if (outR != nullptr) outR[start + i] += r * g;
        // Wraps at an edge and carries a roll's shadow — with no loop on, both are `position_ += rate_`.
        position_ = loop_.step(position_, rate_);
    }
    // Once a block, not once a sample: the state push runs at 20 Hz and an atomic per sample is waste.
    needle_.store(position_ / recordRate_, std::memory_order_relaxed);
    rampGain();
}

}  // namespace studio
