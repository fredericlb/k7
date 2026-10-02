#include "QuickMasterPlugin.h"

#include <algorithm>
#include <cmath>

namespace studio {

namespace te = tracktion::engine;

// Renaming this renames the id a module.yaml may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* QuickMasterPlugin::xmlTypeName = "studio_quickmaster";

namespace {

// The knobs' ranges, in units somebody says out loud: a mastering control reading 0..1 checks against no meter.
constexpr float splitLowMinHz = 40.0f, splitLowMaxHz = 500.0f, splitLowDefHz = 180.0f;
constexpr float splitHighMinHz = 800.0f, splitHighMaxHz = 8000.0f, splitHighDefHz = 3000.0f;
constexpr float amountMin = 0.0f, amountMax = 100.0f;
constexpr float widthMin = 0.0f, widthMax = 200.0f, widthDef = 100.0f;
constexpr float bassMonoMaxHz = 300.0f;
constexpr float driveMaxDb = 12.0f;
constexpr float ceilingMinDb = -12.0f;
constexpr float releaseMinMs = 10.0f, releaseMaxMs = 500.0f, releaseDefMs = 120.0f;
// To Vinyl 4's two: the mid's low cut, 0 being off, and the HF limit's amount in percent.
constexpr float lowCutMaxHz = 300.0f;
constexpr float hfLimitMax = 100.0f;
// The output word length, as a three-way choice: 0 float (untouched), 1 24-bit, 2 16-bit.
constexpr float outputFloat = 0.0f, outputLast = 2.0f;

// Butterworth: two cascaded is a Linkwitz-Riley corner, the only kind that sums back to a flat magnitude.
constexpr double butterworthQ = 0.7071;

// A one-pole coefficient for a time constant in ms — the same shape DspGraph's envelope follower uses.
float coeffFor(float ms, double sampleRate) {
    const double t = juce::jmax(0.1, (double)ms) * 0.001;
    return (float)std::exp(-1.0 / (t * sampleRate));
}

}  // namespace

QuickMasterPlugin::QuickMasterPlugin(te::PluginCreationInfo info) : Plugin(std::move(info))
{
    auto* um = getUndoManager();
    // Backed by a CachedValue on the state, spelled exactly as MixerPlugin does it rather than a second way.
    const auto add = [&](const char* id, const char* name, float lo, float hi,
                         float def) -> te::AutomatableParameter::Ptr {
        auto value = std::make_unique<juce::CachedValue<float>>();
        value->referTo(state, juce::Identifier(juce::String("p_") + name), um, def);
        auto param = addParam(id, name, {lo, hi});
        param->attachToCurrentValue(*value);
        values_.push_back(std::move(value));
        return param;
    };

    // Declared in the order the signal meets them, so the parameter list reads as the chain.
    lowCut_ = add("lowcut", "Low Cut", 0.0f, lowCutMaxHz, 0.0f);
    lowFreq_ = add("lowfreq", "Low Freq", splitLowMinHz, splitLowMaxHz, splitLowDefHz);
    highFreq_ = add("highfreq", "High Freq", splitHighMinHz, splitHighMaxHz, splitHighDefHz);
    lowComp_ = add("lowcomp", "Low Amount", amountMin, amountMax, 0.0f);
    midComp_ = add("midcomp", "Mid Amount", amountMin, amountMax, 0.0f);
    highComp_ = add("highcomp", "High Amount", amountMin, amountMax, 0.0f);
    width_ = add("width", "Width", widthMin, widthMax, widthDef);
    bassMono_ = add("bassmono", "Bass Mono", 0.0f, bassMonoMaxHz, 0.0f);
    hfLimitAmt_ = add("hflimit", "HF Limit", 0.0f, hfLimitMax, 0.0f);
    drive_ = add("drive", "Drive", 0.0f, driveMaxDb, 0.0f);
    ceiling_ = add("ceiling", "Ceiling", ceilingMinDb, 0.0f, 0.0f);
    release_ = add("release", "Release", releaseMinMs, releaseMaxMs, releaseDefMs);
    output_ = add("output", "Output", outputFloat, outputLast, outputFloat);
}

QuickMasterPlugin::~QuickMasterPlugin()
{
    notifyListenersOfDeletion();
    for (auto* p : {lowFreq_.get(), highFreq_.get(), lowComp_.get(), midComp_.get(),
                    highComp_.get(), width_.get(), bassMono_.get(), drive_.get(), ceiling_.get(),
                    release_.get(), output_.get(), lowCut_.get(), hfLimitAmt_.get()})
        if (p != nullptr) p->detachFromCurrentValue();
}

void QuickMasterPlugin::restorePluginStateFromValueTree(const juce::ValueTree& v)
{
    for (auto& value : values_)
        if (auto* p = v.getPropertyPointer(value->getPropertyID()))
            *value = static_cast<float>(*p);
        else
            value->resetToDefault();
    for (auto p : getAutomatableParameters())
        p->updateFromAttachedValue();
}

void QuickMasterPlugin::initialise(const te::PluginInitialisationInfo& info)
{
    rate_ = info.sampleRate > 0.0 ? info.sampleRate : 44100.0;
    maxBlock_ = juce::jmax(1, info.blockSizeSamples);
    // Allocated HERE and never in applyToBuffer: growing a band buffer on the audio thread would be heard.
    for (auto& b : bands_) b.setSize(2, maxBlock_, false, true, false);
    const int n = juce::jmax(1, (int)std::lround(lookaheadMs * 0.001f * rate_));
    for (auto& d : delay_) d.assign((size_t)n + 1, 0.0f);
    reset();
}

void QuickMasterPlugin::deinitialise() {}

void QuickMasterPlugin::reset()
{
    resetPending_ = true;
}

void QuickMasterPlugin::clearState()
{
    for (auto* s : {&lowLp_[0], &lowLp_[1], &restHp_[0], &restHp_[1], &midLp_[0], &midLp_[1],
                    &highHp_[0], &highHp_[1], &lowAp_})
        s->reset();
    for (auto& f : sideHp_) f.reset();
    for (auto& f : midHp_) f.reset();
    for (auto& l : hfLimit_) l.reset();
    lastLowCutHz_ = -1.0f;
    // Forget the cached corners too: initialise() may have moved the sample rate under them.
    lastLowHz_ = lastHighHz_ = lastBassMonoHz_ = -1.0f;
    env_.fill(0.0f);
    limGain_ = 1.0f;
    for (auto& d : dither_) d.reset();
    delayWrite_ = 0;
    for (auto& d : delay_) std::fill(d.begin(), d.end(), 0.0f);
    for (auto& b : bands_) b.clear();
}

void QuickMasterPlugin::updateCoefficients(float lowHz, float highHz, float bassMonoHz)
{
    // The two corners cannot cross: a "low" band above the "high" one is a split with a hole in it.
    const float lo = juce::jlimit(splitLowMinHz, splitLowMaxHz, lowHz);
    const float hi = juce::jmax(lo * 2.0f, juce::jlimit(splitHighMinHz, splitHighMaxHz, highHz));

    const auto lp1 = juce::IIRCoefficients::makeLowPass(rate_, lo, butterworthQ);
    const auto hp1 = juce::IIRCoefficients::makeHighPass(rate_, lo, butterworthQ);
    const auto lp2 = juce::IIRCoefficients::makeLowPass(rate_, hi, butterworthQ);
    const auto hp2 = juce::IIRCoefficients::makeHighPass(rate_, hi, butterworthQ);
    for (auto& s : lowLp_) s.set(lp1);
    for (auto& s : restHp_) s.set(hp1);
    for (auto& s : midLp_) s.set(lp2);
    for (auto& s : highHp_) s.set(hp2);
    // The low band takes the SAME allpass the upper split leaves behind, so the three sum flat.
    lowAp_.set(juce::IIRCoefficients::makeAllPass(rate_, hi, butterworthQ));

    if (bassMonoHz >= bassMonoOffHz)
        for (auto& f : sideHp_)
            f.setCoefficients(juce::IIRCoefficients::makeHighPass(rate_, bassMonoHz, butterworthQ));

    lastLowHz_ = lowHz;
    lastHighHz_ = highHz;
    lastBassMonoHz_ = bassMonoHz;
}

void QuickMasterPlugin::lowCut(juce::AudioBuffer<float>& dst, int start, int numChans, int n)
{
    auto* l = dst.getWritePointer(0, start);
    auto* r = numChans > 1 ? dst.getWritePointer(1, start) : nullptr;
    for (int i = 0; i < n; ++i) {
        // On the MID only: a mono signal is all mid, and a stereo one keeps its side for Bass Mono to treat.
        const float mid = r ? 0.5f * (l[i] + r[i]) : l[i];
        const float cut = midHp_[1].processSingleSampleRaw(midHp_[0].processSingleSampleRaw(mid));
        if (!r) {
            l[i] = cut;
            continue;
        }
        const float side = 0.5f * (l[i] - r[i]);
        l[i] = cut + side;
        r[i] = cut - side;
    }
}

void QuickMasterPlugin::limitHighs(juce::AudioBuffer<float>& dst, int start, int numChans, int n,
                                   double intensity)
{
    for (int ch = 0; ch < numChans; ++ch) {
        float* x = dst.getWritePointer(ch, start);
        for (int i = 0; i < n; ++i) x[i] = (float)hfLimit_[ch].process(x[i], intensity);
    }
}

void QuickMasterPlugin::splitBands(const juce::AudioBuffer<float>& src, int start, int numChans,
                                   int n)
{
    // Low: LR4, then the allpass the upper split imposes on the other two — without it the sum NOTCHES.
    for (int ch = 0; ch < numChans; ++ch) {
        auto* d = bands_[0].getWritePointer(ch);
        juce::FloatVectorOperations::copy(d, src.getReadPointer(ch, start), n);
        lowLp_[0].ch[ch].processSamples(d, n);
        lowLp_[1].ch[ch].processSamples(d, n);
        lowAp_.ch[ch].processSamples(d, n);
    }
    // Everything above the lower corner, split again: a band-pass of its own would not sum back.
    for (int ch = 0; ch < numChans; ++ch) {
        auto* rest = bands_[1].getWritePointer(ch);
        juce::FloatVectorOperations::copy(rest, src.getReadPointer(ch, start), n);
        restHp_[0].ch[ch].processSamples(rest, n);
        restHp_[1].ch[ch].processSamples(rest, n);
        // Copied BEFORE the mid's low-pass runs over `rest` in place.
        auto* high = bands_[2].getWritePointer(ch);
        juce::FloatVectorOperations::copy(high, rest, n);
        highHp_[0].ch[ch].processSamples(high, n);
        highHp_[1].ch[ch].processSamples(high, n);
        midLp_[0].ch[ch].processSamples(rest, n);
        midLp_[1].ch[ch].processSamples(rest, n);
    }
}

void QuickMasterPlugin::compressBands(int numChans, int n)
{
    const float amounts[3] = {lowComp_->getCurrentValue(), midComp_->getCurrentValue(),
                              highComp_->getCurrentValue()};
    for (int b = 0; b < 3; ++b) {
        if (amounts[b] <= 0.0f) {
            // Off means UNTOUCHED, detector and all, so turning the knob up eases in from below the threshold.
            env_[(size_t)b] = 0.0f;
            continue;
        }
        const float t = juce::jlimit(0.0f, 1.0f, amounts[b] * 0.01f);
        const float thrDb = compThresholdTopDb + t * (compThresholdDeepDb - compThresholdTopDb);
        const float ratio = 1.0f + t * (compRatioMax - 1.0f);
        // gain = (threshold / level) ^ (1 - 1/ratio): the dB computer written multiplicatively, one pow.
        const float exponent = 1.0f - 1.0f / ratio;
        const float thrLin = juce::Decibels::decibelsToGain(thrDb);
        const float makeup =
            juce::Decibels::decibelsToGain(-thrDb * exponent * compMakeupShare);
        const float atk = coeffFor(bandAttackMs[(size_t)b], rate_);
        const float rel = coeffFor(bandReleaseMs[(size_t)b], rate_);

        float env = env_[(size_t)b];
        float* d[2] = {bands_[b].getWritePointer(0), numChans > 1 ? bands_[b].getWritePointer(1) : nullptr};
        for (int i = 0; i < n; ++i) {
            // STEREO-LINKED: two detectors would move the channels, and so the image, apart.
            float peak = std::abs(d[0][i]);
            for (int ch = 1; ch < numChans; ++ch) peak = juce::jmax(peak, std::abs(d[ch][i]));
            env = peak + (peak > env ? atk : rel) * (env - peak);
            const float g = env > thrLin ? std::pow(thrLin / env, exponent) * makeup : makeup;
            for (int ch = 0; ch < numChans; ++ch) d[ch][i] *= g;
        }
        env_[(size_t)b] = env;
    }
}

void QuickMasterPlugin::spread(juce::AudioBuffer<float>& dst, int start, int numChans, int n,
                               float width, bool bassMono)
{
    if (numChans < 2) return;  // nothing to widen: mono has no side
    const float w = juce::jlimit(widthMin, widthMax, width) * 0.01f;
    if (w == 1.0f && !bassMono) return;  // identity, and skipping it keeps it bit-exact

    auto* l = dst.getWritePointer(0, start);
    auto* r = dst.getWritePointer(1, start);
    for (int i = 0; i < n; ++i) {
        const float mid = 0.5f * (l[i] + r[i]);
        float side = 0.5f * (l[i] - r[i]);
        // On the SIDE only: what goes is the bottom end's stereo content, and the mid keeps every hertz.
        if (bassMono) side = sideHp_[1].processSingleSampleRaw(sideHp_[0].processSingleSampleRaw(side));
        side *= w;
        l[i] = mid + side;
        r[i] = mid - side;
    }
}

void QuickMasterPlugin::limit(juce::AudioBuffer<float>& dst, int start, int numChans, int n,
                              float driveLin, float ceilLin, float relCoeff)
{
    const int len = (int)delay_[0].size();
    if (len < 2) return;
    // A quarter of the lookahead as a time constant: within 2% of target by the time the peak arrives.
    const float atkCoeff = coeffFor(lookaheadMs * 0.25f, rate_);
    // Taken once, as the split above already does: the compiler does not hoist these by itself.
    float* wr[2] = {dst.getWritePointer(0, start), numChans > 1 ? dst.getWritePointer(1, start) : nullptr};

    for (int i = 0; i < n; ++i) {
        float peak = 0.0f;
        for (int ch = 0; ch < numChans; ++ch) {
            const float x = wr[ch][i] * driveLin;
            delay_[(size_t)ch][(size_t)delayWrite_] = x;
            peak = juce::jmax(peak, std::abs(x));
        }
        const float target = peak > ceilLin ? ceilLin / peak : 1.0f;
        const float c = target < limGain_ ? atkCoeff : relCoeff;
        limGain_ = target + c * (limGain_ - target);

        const int read = (delayWrite_ + 1) % len;
        for (int ch = 0; ch < numChans; ++ch)
            // …and the clip, which is what makes the ceiling a CEILING (docs/quickMaster.md).
            wr[ch][i] = juce::jlimit(-ceilLin, ceilLin, delay_[(size_t)ch][(size_t)read] * limGain_);
        delayWrite_ = read;
    }
}

void QuickMasterPlugin::dither(juce::AudioBuffer<float>& dst, int start, int numChans, int n,
                               int bits, float ceilLin)
{
    // The top a word can hold is one step under full scale, and the ceiling still caps a step rounded up.
    const double step = bits == 24 ? 1.0 / 8388608.0 : 1.0 / 32768.0;
    const double top = juce::jmin((double)ceilLin, 1.0 - step);
    for (int ch = 0; ch < numChans; ++ch) {
        float* x = dst.getWritePointer(ch, start);
        for (int i = 0; i < n; ++i)
            x[i] = (float)juce::jlimit(-(double)ceilLin, top, dither_[ch].process(x[i], bits));
    }
}

void QuickMasterPlugin::applyToBuffer(const te::PluginRenderContext& ctx)
{
    const juce::ScopedNoDenormals noDenormals;  // see GraphDspPlugin::applyToBuffer
    if (ctx.destBuffer == nullptr) return;
    if (resetPending_.exchange(false)) clearState();
    auto& buffer = *ctx.destBuffer;
    const int numChans = juce::jmin(buffer.getNumChannels(), 2);
    if (numChans <= 0 || ctx.bufferNumSamples <= 0) return;

    // The master's last defence: a NaN from upstream would latch in nine biquads and pass the limiter, whose jmax and jlimit both let it through.
    for (int ch = 0; ch < numChans; ++ch) {
        float* x = buffer.getWritePointer(ch, ctx.bufferStartSample);
        for (int i = 0; i < ctx.bufferNumSamples; ++i)
            if (!std::isfinite(x[i])) x[i] = 0.0f;
    }

    const float lowHz = lowFreq_->getCurrentValue();
    const float highHz = highFreq_->getCurrentValue();
    const float bassMonoHz = bassMono_->getCurrentValue();
    // Recomputed only when a corner moved: nine biquads is far from free, and these sit still all session.
    if (lowHz != lastLowHz_ || highHz != lastHighHz_ || bassMonoHz != lastBassMonoHz_)
        updateCoefficients(lowHz, highHz, bassMonoHz);

    const float widthPct = width_->getCurrentValue();
    const float driveLin = juce::Decibels::decibelsToGain(drive_->getCurrentValue());
    const float ceilLin = juce::Decibels::decibelsToGain(ceiling_->getCurrentValue());
    const float relCoeff = coeffFor(release_->getCurrentValue(), rate_);
    const float lowCutHz = lowCut_->getCurrentValue();
    // A moved corner only: the two biquads sit still all session, like the bands' nine.
    if (lowCutHz >= lowCutOffHz && lowCutHz != lastLowCutHz_) {
        const auto hp = juce::IIRCoefficients::makeHighPass(rate_, juce::jmin(lowCutHz, lowCutMaxHz), butterworthQ);
        for (auto& f : midHp_) f.setCoefficients(hp);
        lastLowCutHz_ = lowCutHz;
    }
    const double hfIntensity =
        AccelerationLimiter::intensityFor(hfLimitAmt_->getCurrentValue() / hfLimitMax, rate_);
    const int choice = juce::roundToInt(output_->getCurrentValue());
    const int bits = choice == 1 ? 24 : choice == 2 ? 16 : 0;

    // A block bigger than initialise() was told about is SPLIT, never resized — same answer DspGraph gives.
    for (int done = 0; done < ctx.bufferNumSamples; done += maxBlock_) {
        const int n = juce::jmin(maxBlock_, ctx.bufferNumSamples - done);
        const int start = ctx.bufferStartSample + done;

        if (lowCutHz >= lowCutOffHz) lowCut(buffer, start, numChans, n);
        splitBands(buffer, start, numChans, n);
        compressBands(numChans, n);
        for (int ch = 0; ch < numChans; ++ch) {
            auto* d = buffer.getWritePointer(ch, start);
            juce::FloatVectorOperations::copy(d, bands_[0].getReadPointer(ch), n);
            juce::FloatVectorOperations::add(d, bands_[1].getReadPointer(ch), n);
            juce::FloatVectorOperations::add(d, bands_[2].getReadPointer(ch), n);
        }

        spread(buffer, start, numChans, n, widthPct, bassMonoHz >= bassMonoOffHz);
        if (hfIntensity > 0.0) limitHighs(buffer, start, numChans, n, hfIntensity);
        limit(buffer, start, numChans, n, driveLin, ceilLin, relCoeff);
        if (bits > 0) dither(buffer, start, numChans, n, bits, ceilLin);
    }
}

}  // namespace studio
