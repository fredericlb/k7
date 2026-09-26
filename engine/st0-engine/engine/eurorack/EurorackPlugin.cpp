#include "EurorackPlugin.h"

namespace studio::eurorack {

namespace te = tracktion::engine;

EurorackPlugin::EurorackPlugin(te::PluginCreationInfo info, Shape s)
    : Plugin(std::move(info)), shape_(s)
{
}

EurorackPlugin::~EurorackPlugin()
{
    notifyListenersOfDeletion();
    for (auto& s : slots_) s.param->detachFromCurrentValue();
}

juce::ValueTree EurorackPlugin::createState(const char* xmlTypeName)
{
    juce::ValueTree v(te::IDs::PLUGIN);
    v.setProperty(te::IDs::type, xmlTypeName, nullptr);
    return v;
}

EurorackPlugin::Param EurorackPlugin::knob(const char* id, const char* name, float min, float max,
                                           float def, const char* unit)
{
    auto value = std::make_unique<juce::CachedValue<float>>();
    value->referTo(state, juce::Identifier(id), getUndoManager(), def);
    const juce::String suffix(unit);
    // Two decimals below 10, whole numbers above: a semitone reads as 7, a timbre as 0.43.
    auto toText = [suffix](float v) {
        const auto t = std::abs(v) < 10.0f ? juce::String(v, 2) : juce::String(juce::roundToInt(v));
        return suffix.isEmpty() ? t : t + " " + suffix;
    };
    auto fromText = [](const juce::String& t) { return t.getFloatValue(); };
    Param p = addParam(id, name, {min, max}, toText, fromText);
    p->attachToCurrentValue(*value);
    slots_.push_back({p, std::move(value)});
    return p;
}

EurorackPlugin::Param EurorackPlugin::choice(const char* id, const char* name,
                                             const juce::StringArray& labels, int def)
{
    auto value = std::make_unique<juce::CachedValue<float>>();
    value->referTo(state, juce::Identifier(id), getUndoManager(), (float)def);
    Param p = new te::DiscreteLabelledParameter(id, name, *this,
                                                {0.0f, (float)(labels.size() - 1)},
                                                labels.size(), labels);
    addAutomatableParameter(p);
    p->attachToCurrentValue(*value);
    slots_.push_back({p, std::move(value)});
    return p;
}

void EurorackPlugin::restorePluginStateFromValueTree(const juce::ValueTree& v)
{
    for (auto& s : slots_) {
        if (auto* p = v.getPropertyPointer(s.value->getPropertyID()))
            *s.value = static_cast<float>(*p);
        else
            s.value->resetToDefault();
    }
    for (auto p : getAutomatableParameters()) p->updateFromAttachedValue();
}

void EurorackPlugin::getChannelNames(juce::StringArray* ins, juce::StringArray* outs)
{
    te::Plugin::getChannelNames(ins, outs);
    if (ins != nullptr && shape_.inChannels > 2) {
        ins->add("Sidechain L");
        ins->add("Sidechain R");
    }
}

double EurorackPlugin::getLatencySeconds()
{
    return hostRate_ > 0.0 ? bridge_.latencySamples() / hostRate_ : 0.0;
}

void EurorackPlugin::initialise(const te::PluginInitialisationInfo& info)
{
    hostRate_ = info.sampleRate > 0.0 ? info.sampleRate : 48000.0;
    const double coreRate = shape_.coreRate > 0.0 ? shape_.coreRate : hostRate_;
    prepareCore(coreRate);
    bridge_.prepare(hostRate_, coreRate, shape_.coreBlock, shape_.inChannels, 2, *this);
    const auto n = (size_t)juce::jmax(info.blockSizeSamples, 1);
    in_.assign((size_t)shape_.inChannels, std::vector<float>(n, 0.0f));
    out_.assign(2, std::vector<float>(n, 0.0f));
}

void EurorackPlugin::reset()
{
    bridge_.reset();
}

void EurorackPlugin::applyToBuffer(const te::PluginRenderContext& ctx)
{
    // Resonators and reverbs are the canonical denormal generators, and the symptom is an engine that slows down.
    const juce::ScopedNoDenormals noDenormals;
    if (ctx.destBuffer == nullptr) return;
    const int n = ctx.bufferNumSamples;
    const int start = ctx.bufferStartSample;
    if (n <= 0 || out_.empty() || n > (int)out_[0].size()) return;

    readParams();

    const int chans = ctx.destBuffer->getNumChannels();
    for (int c = 0; c < shape_.inChannels; ++c) {
        auto& dst = in_[(size_t)c];
        // A mono track feeds both sides of a pair; a missing sidechain is silence, never the main input again.
        const int from = c < 2 ? juce::jmin(c, chans - 1) : c;
        if (from >= 0 && from < chans)
            std::copy_n(ctx.destBuffer->getReadPointer(from, start), n, dst.data());
        else
            std::fill_n(dst.data(), n, 0.0f);
    }

    const float* inPtr[4] = {};
    float* outPtr[2] = {};
    const auto segment = [&](int from, int len) {
        if (len <= 0) return;
        for (int c = 0; c < shape_.inChannels && c < 4; ++c) inPtr[c] = in_[(size_t)c].data() + from;
        for (int c = 0; c < 2; ++c) outPtr[c] = out_[(size_t)c].data() + from;
        bridge_.run(shape_.inChannels > 0 ? inPtr : nullptr, outPtr, len);
    };

    if (!shape_.midi || ctx.bufferForMidiMessages == nullptr) {
        segment(0, n);
    } else {
        // Cut at every message, as FaustPlugin does, so each lands on its own sample (docs/faust.md).
        const double rate = sampleRate > 0.0 ? sampleRate : hostRate_;
        int done = 0;
        auto it = ctx.bufferForMidiMessages->begin();
        const auto end = ctx.bufferForMidiMessages->end();
        while (done < n) {
            int next = n;
            while (it != end) {
                const double secs = it->getTimeStamp() - ctx.midiBufferOffset;
                const int at = juce::jlimit(0, n, (int)(secs * rate));
                if (at > done) {
                    next = at;
                    break;
                }
                handleMidi(*it);
                ++it;
            }
            segment(done, next - done);
            done = next;
        }
    }

    for (int c = 0; c < juce::jmin(chans, 2); ++c)
        std::copy_n(out_[(size_t)c].data(), n, ctx.destBuffer->getWritePointer(c, start));
}

}  // namespace studio::eurorack
