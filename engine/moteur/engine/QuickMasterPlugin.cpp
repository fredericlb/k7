#include "QuickMasterPlugin.h"

#include <algorithm>
#include <cmath>

namespace studio {

namespace te = tracktion::engine;

// Renaming this renames the id a module.yaml may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* QuickMasterPlugin::xmlTypeName = "studio_quickmaster";

namespace {

// The knobs' ranges, in the units a master bus is read in. Every one of them is a number somebody
// says out loud — hertz, decibels, milliseconds, percent — because a mastering control that reads
// 0..1 is one nobody can check against a meter. See docs/quickMaster.md.
constexpr float splitLowMinHz = 40.0f, splitLowMaxHz = 500.0f, splitLowDefHz = 180.0f;
constexpr float splitHighMinHz = 800.0f, splitHighMaxHz = 8000.0f, splitHighDefHz = 3000.0f;
constexpr float amountMin = 0.0f, amountMax = 100.0f;
constexpr float widthMin = 0.0f, widthMax = 200.0f, widthDef = 100.0f;
constexpr float bassMonoMaxHz = 300.0f;
constexpr float driveMaxDb = 12.0f;
constexpr float ceilingMinDb = -12.0f;
constexpr float releaseMinMs = 10.0f, releaseMaxMs = 500.0f, releaseDefMs = 120.0f;

// Butterworth. Two of these cascaded is a Linkwitz-Riley corner, which is the only kind that sums
// back to a flat magnitude — see docs/quickMaster.md.
constexpr double butterworthQ = 0.7071;

// A one-pole coefficient for a time constant in ms: the fraction of the gap left after one sample.
// The same shape DspGraph's envelope follower uses, so the two read alike.
float coeffFor(float ms, double sampleRate) {
    const double t = juce::jmax(0.1, (double)ms) * 0.001;
    return (float)std::exp(-1.0 / (t * sampleRate));
}

}  // namespace

QuickMasterPlugin::QuickMasterPlugin(te::PluginCreationInfo info) : Plugin(std::move(info))
{
    auto* um = getUndoManager();
    // Each parameter is backed by a CachedValue on the state, which is what makes it survive a save
    // and reload and what the doc's `params:` map writes into. Copied from MixerPlugin deliberately:
    // a second spelling of this would be a second thing to get wrong.
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
    lowFreq_ = add("lowfreq", "Low Freq", splitLowMinHz, splitLowMaxHz, splitLowDefHz);
    highFreq_ = add("highfreq", "High Freq", splitHighMinHz, splitHighMaxHz, splitHighDefHz);
    lowComp_ = add("lowcomp", "Low Amount", amountMin, amountMax, 0.0f);
    midComp_ = add("midcomp", "Mid Amount", amountMin, amountMax, 0.0f);
    highComp_ = add("highcomp", "High Amount", amountMin, amountMax, 0.0f);
    width_ = add("width", "Width", widthMin, widthMax, widthDef);
    bassMono_ = add("bassmono", "Bass Mono", 0.0f, bassMonoMaxHz, 0.0f);
    drive_ = add("drive", "Drive", 0.0f, driveMaxDb, 0.0f);
    ceiling_ = add("ceiling", "Ceiling", ceilingMinDb, 0.0f, 0.0f);
    release_ = add("release", "Release", releaseMinMs, releaseMaxMs, releaseDefMs);
}

QuickMasterPlugin::~QuickMasterPlugin()
{
    notifyListenersOfDeletion();
    for (auto* p : {lowFreq_.get(), highFreq_.get(), lowComp_.get(), midComp_.get(),
                    highComp_.get(), width_.get(), bassMono_.get(), drive_.get(), ceiling_.get(),
                    release_.get()})
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
    // Allocated HERE and never in applyToBuffer: three band buffers and a delay line are the only
    // things in this plugin big enough that growing them on the audio thread would be heard.
    for (auto& b : bands_) b.setSize(2, maxBlock_, false, true, false);
    const int n = juce::jmax(1, (int)std::lround(lookaheadMs * 0.001f * rate_));
    for (auto& d : delay_) d.assign((size_t)n + 1, 0.0f);
    reset();
}

void QuickMasterPlugin::deinitialise() {}

void QuickMasterPlugin::reset()
{
    for (auto* s : {&lowLp_[0], &lowLp_[1], &restHp_[0], &restHp_[1], &midLp_[0], &midLp_[1],
                    &highHp_[0], &highHp_[1], &lowAp_})
        s->reset();
    for (auto& f : sideHp_) f.reset();
    // Forget the cached corners too: reset() follows initialise(), and initialise() may have moved
    // the sample rate under coefficients that are only recomputed when a knob moves.
    lastLowHz_ = lastHighHz_ = lastBassMonoHz_ = -1.0f;
    env_.fill(0.0f);
    limGain_ = 1.0f;
    delayWrite_ = 0;
    for (auto& d : delay_) std::fill(d.begin(), d.end(), 0.0f);
    for (auto& b : bands_) b.clear();
}

void QuickMasterPlugin::updateCoefficients(float lowHz, float highHz, float bassMonoHz)
{
    // The two corners cannot cross: a "low" band above the "high" one is a split with a hole in it
    // and a band that is the inverse of what its knob says.
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

void QuickMasterPlugin::splitBands(const juce::AudioBuffer<float>& src, int start, int numChans,
                                   int n)
{
    // Low: two Butterworth sections (LR4), then the allpass that the upper split will impose on the
    // other two — without it the sum notches by several dB around the lower corner.
    for (int ch = 0; ch < numChans; ++ch) {
        auto* d = bands_[0].getWritePointer(ch);
        juce::FloatVectorOperations::copy(d, src.getReadPointer(ch, start), n);
        lowLp_[0].ch[ch].processSamples(d, n);
        lowLp_[1].ch[ch].processSamples(d, n);
        lowAp_.ch[ch].processSamples(d, n);
    }
    // Everything above the lower corner, then split again — which is why the mid is a band and not
    // a band-pass: a band-pass of its own would not sum back with the other two.
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
            // Off, and off means untouched — not "a ratio of 1 with a makeup". The detector goes
            // back to silence so turning the knob up starts below the threshold and eases in,
            // rather than jumping to whatever the level was when it was last on.
            env_[(size_t)b] = 0.0f;
            continue;
        }
        const float t = juce::jlimit(0.0f, 1.0f, amounts[b] * 0.01f);
        const float thrDb = compThresholdTopDb + t * (compThresholdDeepDb - compThresholdTopDb);
        const float ratio = 1.0f + t * (compRatioMax - 1.0f);
        // gain = (threshold / level) ^ (1 - 1/ratio), which is the dB gain computer written
        // multiplicatively so the per-sample path needs one pow instead of a log and an exp.
        const float exponent = 1.0f - 1.0f / ratio;
        const float thrLin = juce::Decibels::decibelsToGain(thrDb);
        const float makeup =
            juce::Decibels::decibelsToGain(-thrDb * exponent * compMakeupShare);
        const float atk = coeffFor(bandAttackMs[(size_t)b], rate_);
        const float rel = coeffFor(bandReleaseMs[(size_t)b], rate_);

        float env = env_[(size_t)b];
        float* d[2] = {bands_[b].getWritePointer(0), numChans > 1 ? bands_[b].getWritePointer(1) : nullptr};
        for (int i = 0; i < n; ++i) {
            // STEREO-LINKED: one detector for the pair. Two would move the channels apart, which
            // moves the image with them — the one thing a mastering compressor must not do.
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
        // The bass-mono corner runs on the SIDE only, so what it removes is the stereo content of
        // the bottom end — the mid keeps every hertz it had.
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
    // The gain falls over the lookahead rather than instantly: a step in the gain is a click, and
    // a quarter of the window as a time constant puts it within 2% of target by the time the peak
    // it was computed from actually arrives.
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
            // …and the clip, which is what makes the ceiling a CEILING. The limiter above does the
            // musical work and normally leaves nothing for this to do; what it catches is the
            // fraction of a dB a one-pole attack cannot take off a transient in time.
            wr[ch][i] = juce::jlimit(-ceilLin, ceilLin, delay_[(size_t)ch][(size_t)read] * limGain_);
        delayWrite_ = read;
    }
}

void QuickMasterPlugin::applyToBuffer(const te::PluginRenderContext& ctx)
{
    const juce::ScopedNoDenormals noDenormals;  // see GraphDspPlugin::applyToBuffer
    if (ctx.destBuffer == nullptr) return;
    auto& buffer = *ctx.destBuffer;
    const int numChans = juce::jmin(buffer.getNumChannels(), 2);
    if (numChans <= 0 || ctx.bufferNumSamples <= 0) return;

    const float lowHz = lowFreq_->getCurrentValue();
    const float highHz = highFreq_->getCurrentValue();
    const float bassMonoHz = bassMono_->getCurrentValue();
    // Recomputed only when a corner has actually moved: designing nine biquads is far from free,
    // and a master bus's crossovers sit still for a whole session.
    if (lowHz != lastLowHz_ || highHz != lastHighHz_ || bassMonoHz != lastBassMonoHz_)
        updateCoefficients(lowHz, highHz, bassMonoHz);

    const float widthPct = width_->getCurrentValue();
    const float driveLin = juce::Decibels::decibelsToGain(drive_->getCurrentValue());
    const float ceilLin = juce::Decibels::decibelsToGain(ceiling_->getCurrentValue());
    const float relCoeff = coeffFor(release_->getCurrentValue(), rate_);

    // Never grow a buffer in here. A block bigger than initialise() was told about — an offline
    // render, a device buffer that outran a re-initialise — is SPLIT rather than resized, which is
    // finer-grained rather than wrong. Same answer DspGraph::process gives.
    for (int done = 0; done < ctx.bufferNumSamples; done += maxBlock_) {
        const int n = juce::jmin(maxBlock_, ctx.bufferNumSamples - done);
        const int start = ctx.bufferStartSample + done;

        splitBands(buffer, start, numChans, n);
        compressBands(numChans, n);
        for (int ch = 0; ch < numChans; ++ch) {
            auto* d = buffer.getWritePointer(ch, start);
            juce::FloatVectorOperations::copy(d, bands_[0].getReadPointer(ch), n);
            juce::FloatVectorOperations::add(d, bands_[1].getReadPointer(ch), n);
            juce::FloatVectorOperations::add(d, bands_[2].getReadPointer(ch), n);
        }

        spread(buffer, start, numChans, n, widthPct, bassMonoHz >= bassMonoOffHz);
        limit(buffer, start, numChans, n, driveLin, ceilLin, relCoeff);
    }
}

}  // namespace studio
