// MixBlend.cpp — the split, the blend and the helpers that keep them beside their module; see MixBlend.h and docs/mix.md.

#include "MixBlend.h"

#include "PluginParams.h"
#include "Warnings.h"

#include <cmath>
#include <regex>

namespace te = tracktion::engine;

namespace studio {

const char* MixSplitPlugin::xmlTypeName = "mixSplit";
const char* MixBlendPlugin::xmlTypeName = "mixBlend";

MixSplitPlugin::MixSplitPlugin(te::PluginCreationInfo info) : Plugin(std::move(info)) {}
MixSplitPlugin::~MixSplitPlugin() { notifyListenersOfDeletion(); }

void MixSplitPlugin::applyToBuffer(const te::PluginRenderContext& ctx)
{
    auto* l = link_.get();
    if (l == nullptr || ctx.destBuffer == nullptr) return;
    const int n = ctx.bufferNumSamples;
    const int chans = ctx.destBuffer->getNumChannels();
    if (n <= 0 || chans <= 0) return;
    // The input level FIRST, ramped: the module and the dry copy both hear the trimmed signal.
    const float g = l->inGain.load(std::memory_order_relaxed);
    if (lastIn_ < 0.0f) lastIn_ = g;
    if (g != 1.0f || lastIn_ != 1.0f)
        ctx.destBuffer->applyGainRamp(ctx.bufferStartSample, n, lastIn_, g);
    lastIn_ = g;
    l->blockStart.store(write_, std::memory_order_release);
    for (int c = 0; c < MixLink::CHANNELS; ++c) {
        // Mono feeds both sides, as the blend reads them.
        const float* src = ctx.destBuffer->getReadPointer(c < chans ? c : 0, ctx.bufferStartSample);
        for (int i = 0; i < n; ++i)
            l->ring[((write_ + (size_t)i) & MixLink::MASK) * MixLink::CHANNELS + (size_t)c] = src[i];
    }
    write_ += (size_t)n;
}

MixBlendPlugin::MixBlendPlugin(te::PluginCreationInfo info) : Plugin(std::move(info)) {}
MixBlendPlugin::~MixBlendPlugin() { notifyListenersOfDeletion(); }

void MixBlendPlugin::setLink(std::shared_ptr<MixLink> link, te::Plugin::Ptr module)
{
    link_ = std::move(link);
    module_ = std::move(module);
}

void MixBlendPlugin::initialise(const te::PluginInitialisationInfo& info)
{
    // Re-run whenever the graph is rebuilt, which is also what a change of the module's latency causes.
    const double seconds = module_ != nullptr ? module_->getLatencySeconds() : 0.0;
    const auto frames = (long long)std::llround(seconds * info.sampleRate);
    latency_.store((int)juce::jlimit(0LL, (long long)(MixLink::CAPACITY / 2), frames), std::memory_order_relaxed);
}

void MixBlendPlugin::applyToBuffer(const te::PluginRenderContext& ctx)
{
    auto* l = link_.get();
    if (l == nullptr || ctx.destBuffer == nullptr) return;
    const int n = ctx.bufferNumSamples;
    const int chans = juce::jmin(ctx.destBuffer->getNumChannels(), MixLink::CHANNELS);
    if (n <= 0 || chans <= 0) return;

    // Bypassed, the module passed its input through: that IS the dry signal, and blending it with itself would add 3 dB.
    const bool bypassed = module_ != nullptr && !module_->isEnabled();
    const float m = juce::jlimit(0.0f, 1.0f, l->mix.load(std::memory_order_relaxed));
    const float wet = std::sin(m * juce::MathConstants<float>::halfPi);
    const float dry = std::cos(m * juce::MathConstants<float>::halfPi);
    if (lastWet_ < 0.0f) {
        lastWet_ = wet;
        lastDry_ = dry;
    }
    // Blended unless bypassed or all wet and staying so.
    if (!bypassed && !(dry <= 0.0f && lastDry_ <= 0.0f)) {
        const size_t base = l->blockStart.load(std::memory_order_acquire) - (size_t)latency_.load(std::memory_order_relaxed);
        for (int c = 0; c < chans; ++c) {
            float* out = ctx.destBuffer->getWritePointer(c, ctx.bufferStartSample);
            for (int i = 0; i < n; ++i) {
                const float t = (float)(i + 1) / (float)n;
                const float gw = lastWet_ + (wet - lastWet_) * t;
                const float gd = lastDry_ + (dry - lastDry_) * t;
                const float d = l->ring[((base + (size_t)i) & MixLink::MASK) * MixLink::CHANNELS + (size_t)c];
                out[i] = out[i] * gw + d * gd;
            }
        }
    }
    lastWet_ = wet;
    lastDry_ = dry;
    // The output level LAST, bypassed or not: it is the module's level, not its effect's.
    const float g = l->outGain.load(std::memory_order_relaxed);
    if (lastOut_ < 0.0f) lastOut_ = g;
    if (g != 1.0f || lastOut_ != 1.0f)
        ctx.destBuffer->applyGainRamp(ctx.bufferStartSample, n, lastOut_, g);
    lastOut_ = g;
}

MixBlendPlugin* mixBlendOf(te::Plugin& module)
{
    auto* list = module.getOwnerList();
    if (list == nullptr) return nullptr;
    const int i = list->indexOf(&module);
    if (i < 0 || i + 1 >= list->size()) return nullptr;
    return dynamic_cast<MixBlendPlugin*>((*list)[i + 1]);
}

/** The module's stage, put around it the first time: a blend after, and a split before unless it is an instrument. */
static MixLink* stageOf(te::Plugin& module)
{
    if (auto* blend = mixBlendOf(module)) return blend->link().get();
    auto* list = module.getOwnerList();
    if (list == nullptr) return nullptr;
    auto& cache = module.edit.getPluginCache();
    auto blend = cache.createNewPlugin(MixBlendPlugin::xmlTypeName, {});
    auto* b = dynamic_cast<MixBlendPlugin*>(blend.get());
    if (b == nullptr) return nullptr;
    auto link = std::make_shared<MixLink>();
    // An instrument's input is the silence before it: no split, so nothing to trim or keep.
    te::Plugin::Ptr split;
    if (!module.isSynth()) {
        split = cache.createNewPlugin(MixSplitPlugin::xmlTypeName, {});
        auto* s = dynamic_cast<MixSplitPlugin*>(split.get());
        if (s == nullptr) return nullptr;
        // Linked BEFORE it is in the chain, so no block ever runs it without its link.
        s->setLink(link);
    }
    b->setLink(link, &module);
    const int at = list->indexOf(&module);
    list->insertPlugin(blend, at + 1, nullptr);
    if (split != nullptr) list->insertPlugin(split, at, nullptr);
    return link.get();
}

static float gainOfDb(double db)
{
    return juce::Decibels::decibelsToGain((float)juce::jlimit(-60.0, 12.0, db), -60.0f);
}

void setModuleMix(te::Plugin& module, double mix)
{
    const float m = juce::jlimit(0.0f, 1.0f, (float)mix);
    // Fully wet with no stage yet: nothing to blend, so nothing is inserted.
    if (m >= 1.0f && mixBlendOf(module) == nullptr) return;
    if (module.isSynth()) {
        if (m < 1.0f)
            warn("'" + module.getName().toStdString() + "' is an instrument: @mix blends an EFFECT's input back in, and an instrument has none");
        return;
    }
    if (auto* l = stageOf(module)) l->mix.store(m, std::memory_order_relaxed);
}

void setModuleInputDb(te::Plugin& module, double db)
{
    if (db == 0.0 && mixBlendOf(module) == nullptr) return;
    if (module.isSynth()) {
        warn("'" + module.getName().toStdString() + "' is an instrument: @input-volume trims an audio INPUT, and an instrument has none");
        return;
    }
    if (auto* l = stageOf(module)) l->inGain.store(gainOfDb(db), std::memory_order_relaxed);
}

void setModuleOutputDb(te::Plugin& module, double db)
{
    if (db == 0.0 && mixBlendOf(module) == nullptr) return;
    if (auto* l = stageOf(module)) l->outGain.store(gainOfDb(db), std::memory_order_relaxed);
}

std::vector<std::pair<std::string, double>> stageParams(te::Plugin& module)
{
    auto* blend = mixBlendOf(module);
    if (blend == nullptr) return {};
    const auto& l = *blend->link();
    const auto db = [](float g) { return (double)juce::Decibels::gainToDecibels(g, -60.0f); };
    return {{kMixParam, l.mix.load(std::memory_order_relaxed)},
            {kInputVolumeParam, db(l.inGain.load(std::memory_order_relaxed))},
            {kOutputVolumeParam, db(l.outGain.load(std::memory_order_relaxed))}};
}

int ownMixSide(const std::string& name)
{
    // The same words `ownMixSide` in @studio/song-schema reads, so the compile and the engine agree on which params these are.
    static const std::regex wet(R"(\b(wet|mix)\b)", std::regex::icase);
    static const std::regex dry(R"(\bdry\b)", std::regex::icase);
    if (!name.empty() && name[0] == '@') return 0;
    if (std::regex_search(name, wet)) return 1;
    if (std::regex_search(name, dry)) return -1;
    return 0;
}

int ownLevelSide(const std::string& name)
{
    // The same WHOLE names `ownLevelSide` in @studio/song-schema reads: "Output", "Input Gain", "Out Level".
    static const std::regex in(R"(^(input|in)(\s+(volume|vol|gain|level|lvl|trim))?$)", std::regex::icase);
    static const std::regex out(R"(^(output|out)(\s+(volume|vol|gain|level|lvl|trim))?$)", std::regex::icase);
    if (std::regex_match(name, in)) return 1;
    if (std::regex_match(name, out)) return -1;
    return 0;
}

// Properties on the plugin's own state, so a mark lives and dies with the instance.
static const juce::Identifier kOwnMixHeld{"st0OwnMixHeld"};
static const juce::Identifier kOwnInHeld{"st0OwnInHeld"};
static const juce::Identifier kOwnOutHeld{"st0OwnOutHeld"};

void holdOwnMix(te::Plugin& module)
{
    if (module.isSynth()) return;
    for (const auto& p : pluginParams(module)) {
        const int side = ownMixSide(p.name.toStdString());
        if (side > 0) p.set(p.max);
        else if (side < 0) p.set(p.min);
    }
    module.state.setProperty(kOwnMixHeld, true, nullptr);
}

void holdOwnLevel(te::Plugin& module, int side)
{
    for (const auto& p : pluginParams(module)) {
        if (ownLevelSide(p.name.toStdString()) != side) continue;
        // Its OWN neutral: the default it publishes, else 0 on a range that holds it (dB), else left where it is.
        if (p.def.has_value()) p.set(*p.def);
        else if (p.min < 0.0 && p.max > 0.0) p.set(0.0);
    }
    module.state.setProperty(side > 0 ? kOwnInHeld : kOwnOutHeld, true, nullptr);
}

bool heldByStage(const te::Plugin& module, const std::string& name)
{
    const int level = ownLevelSide(name);
    if (level > 0) return (bool)module.state.getProperty(kOwnInHeld, false);
    if (level < 0) return (bool)module.state.getProperty(kOwnOutHeld, false);
    return ownMixSide(name) != 0 && (bool)module.state.getProperty(kOwnMixHeld, false);
}

int indexAfterModule(te::PluginList& list, te::Plugin* module)
{
    const int i = list.indexOf(module);
    if (i < 0) return list.size();
    return (i + 1 < list.size() && dynamic_cast<MixBlendPlugin*>(list[i + 1]) != nullptr) ? i + 2 : i + 1;
}

void removeMixPair(te::Plugin& module)
{
    auto* list = module.getOwnerList();
    if (list == nullptr) return;
    const int i = list->indexOf(&module);
    if (i < 0) return;
    // The blend first: removing it leaves the split's index where it was.
    if (i + 1 < list->size())
        if (auto* b = dynamic_cast<MixBlendPlugin*>((*list)[i + 1])) b->deleteFromParent();
    if (i > 0)
        if (auto* s = dynamic_cast<MixSplitPlugin*>((*list)[i - 1])) s->deleteFromParent();
}

}  // namespace studio
