#include "FaustPlugin.h"
#include "Warnings.h"

#include "faust/dsp/interpreter-dsp.h"
#include "faust/gui/UI.h"

#include <algorithm>

namespace studio {

namespace te = tracktion::engine;

// Renaming this renames the id a module.yaml may name a built-in by — see resolveBuiltInType in
// EditBuilder.cpp.
const char* FaustPlugin::xmlTypeName = "studio_faust";

namespace {

/**
 * The controls a program declares, collected in the order Faust reports them.
 *
 * Groups are ignored on purpose. A Faust `hgroup`/`vgroup` nests a control's full path, which is
 * how its own UIs lay a panel out — but a module's face here is `ui.yaml`, drawn by hand against
 * PARAMETER NAMES. Folding the path in would make those names depend on how somebody grouped
 * the source, so the leaf label is the name and the grouping is the panel's business.
 */
struct Controls : public UI {
    struct Entry {
        std::string label;
        float* zone;
        float init, min, max;
        bool toggle;   // a button or a check button: two states, not a range
    };
    std::vector<Entry> entries;

    void openTabBox(const char*) override {}
    void openHorizontalBox(const char*) override {}
    void openVerticalBox(const char*) override {}
    void closeBox() override {}
    void addButton(const char* l, FAUSTFLOAT* z) override { entries.push_back({l, z, 0, 0, 1, true}); }
    void addCheckButton(const char* l, FAUSTFLOAT* z) override { entries.push_back({l, z, 0, 0, 1, true}); }
    void addVerticalSlider(const char* l, FAUSTFLOAT* z, FAUSTFLOAT i, FAUSTFLOAT a, FAUSTFLOAT b,
                           FAUSTFLOAT) override { entries.push_back({l, z, i, a, b, false}); }
    void addHorizontalSlider(const char* l, FAUSTFLOAT* z, FAUSTFLOAT i, FAUSTFLOAT a, FAUSTFLOAT b,
                             FAUSTFLOAT) override { entries.push_back({l, z, i, a, b, false}); }
    void addNumEntry(const char* l, FAUSTFLOAT* z, FAUSTFLOAT i, FAUSTFLOAT a, FAUSTFLOAT b,
                     FAUSTFLOAT) override { entries.push_back({l, z, i, a, b, false}); }
    // A bargraph is an OUTPUT — the program writes it for a meter to read. Not a parameter, and
    // exposing one as an automatable control would let a fader write where only the DSP should.
    void addHorizontalBargraph(const char*, FAUSTFLOAT*, FAUSTFLOAT, FAUSTFLOAT) override {}
    void addVerticalBargraph(const char*, FAUSTFLOAT*, FAUSTFLOAT, FAUSTFLOAT) override {}
    void addSoundfile(const char*, const char*, Soundfile**) override {}
};

}  // namespace

juce::File FaustPlugin::faustLibrariesDir()
{
    const auto beside = juce::File::getSpecialLocation(juce::File::currentExecutableFile)
                            .getParentDirectory()
                            .getChildFile("faust-libs");
    if (beside.isDirectory()) return beside;
    return juce::File{juce::String{STUDIO_FAUST_LIBS_DEV}};
}

juce::ValueTree FaustPlugin::create()
{
    juce::ValueTree v(te::IDs::PLUGIN);
    v.setProperty(te::IDs::type, xmlTypeName, nullptr);
    return v;
}

FaustPlugin::FaustPlugin(te::PluginCreationInfo info)
    : Plugin(std::move(info))
{
    if (state.hasProperty("faust"))
        source_ = state.getProperty("faust").toString().toStdString();

    if (source_.empty()) {
        warn("faust module carries no source - is dsp.dsp missing from its folder?");
        return;
    }

    const auto libs = faustLibrariesDir();
    const auto libsPath = libs.getFullPathName().toStdString();
    const char* argv[] = {"-I", libsPath.c_str()};
    std::string error;
    // COMPILED HERE, in the constructor, because the parameters below are the program's and
    // Tracktion creates AutomatableParameters nowhere else.
    factory_ = createInterpreterDSPFactoryFromString("studio", source_, 2, argv, error);
    if (factory_ == nullptr) {
        // Faust's message names the line and the symbol; passing it through verbatim is the
        // whole value — a paraphrase would send somebody to the wrong place in their file.
        warn("faust: " + error);
        return;
    }

    dsp_ = factory_->createDSPInstance();
    numIn_ = dsp_->getNumInputs();
    numOut_ = dsp_->getNumOutputs();
    // Initialised at a placeholder rate so the control zones exist to be read; `initialise` does
    // it again with the real one, which is what the program actually runs at.
    dsp_->init(44100);

    Controls controls;
    dsp_->buildUserInterface(&controls);

    auto* um = getUndoManager();
    for (const auto& c : controls.entries) {
        const juce::String name(c.label);
        auto value = std::make_unique<juce::CachedValue<float>>();
        value->referTo(state, juce::Identifier("p_" + name), um, c.init);

        te::AutomatableParameter::Ptr param;
        if (c.toggle) {
            juce::StringArray labels{"off", "on"};
            param = new te::DiscreteLabelledParameter(name.toLowerCase(), name, *this, {0.0f, 1.0f},
                                                      2, labels);
            addAutomatableParameter(param);
        } else {
            param = addParam(name.toLowerCase(), name, {c.min, c.max});
        }
        param->attachToCurrentValue(*value);
        params_.push_back(param);
        values_.push_back(std::move(value));
        zones_.push_back(c.zone);
    }
}

FaustPlugin::~FaustPlugin()
{
    notifyListenersOfDeletion();
    for (auto& p : params_) p->detachFromCurrentValue();
    // The instance before the factory: the factory owns the code the instance runs.
    delete dsp_;
    dsp_ = nullptr;
    if (factory_ != nullptr) deleteInterpreterDSPFactory(factory_);
}

bool FaustPlugin::takesAudioInput() { return numIn_ > 0; }

// An instrument — `process` with no input — has to be run even on a track with nothing feeding
// it, or it never produces its first sample.
bool FaustPlugin::producesAudioWhenNoAudioInput() { return numIn_ == 0; }

int FaustPlugin::getNumOutputChannelsGivenInputs(int n)
{
    if (dsp_ == nullptr) return juce::jmin(n, 2);
    return juce::jmin(numOut_, 2);
}

void FaustPlugin::restorePluginStateFromValueTree(const juce::ValueTree& v)
{
    for (auto& value : values_)
        if (auto* p = v.getPropertyPointer(value->getPropertyID()))
            *value = static_cast<float>(*p);
        else
            value->resetToDefault();
    for (auto p : getAutomatableParameters())
        p->updateFromAttachedValue();
}

void FaustPlugin::initialise(const te::PluginInitialisationInfo& info)
{
    if (dsp_ == nullptr) return;
    dsp_->init(static_cast<int>(info.sampleRate));

    // The scratch buffers, allocated once HERE and never in the callback. Faust is handed
    // separate input and output pointers because a program may read an input after writing an
    // output — in-place is not something a `.dsp` promises.
    const auto n = static_cast<size_t>(std::max(info.blockSizeSamples, 1));
    in_.assign(static_cast<size_t>(std::max(numIn_, 1)), std::vector<float>(n, 0.0f));
    out_.assign(static_cast<size_t>(std::max(numOut_, 1)), std::vector<float>(n, 0.0f));
    inPtr_.clear();
    outPtr_.clear();
    for (auto& c : in_) inPtr_.push_back(c.data());
    for (auto& c : out_) outPtr_.push_back(c.data());
}

void FaustPlugin::deinitialise() {}

void FaustPlugin::reset()
{
    if (dsp_ != nullptr) dsp_->instanceClear();
}

void FaustPlugin::applyToBuffer(const te::PluginRenderContext& ctx)
{
    // A resonant filter's tail is the canonical denormal generator, and the symptom is an engine
    // that gets slower the longer it plays. Same reason GraphDspPlugin carries one.
    const juce::ScopedNoDenormals noDenormals;
    if (ctx.destBuffer == nullptr || dsp_ == nullptr) return;

    const int n = ctx.bufferNumSamples;
    const int start = ctx.bufferStartSample;
    if (n <= 0 || n > static_cast<int>(in_.empty() ? 0 : in_[0].size())) return;

    // The parameters, read once per block — the audio path never touches Tracktion's parameter
    // objects beyond this loop.
    for (size_t i = 0; i < zones_.size(); ++i)
        *zones_[i] = params_[i]->getCurrentValue();

    const int chans = ctx.destBuffer->getNumChannels();
    for (int c = 0; c < numIn_; ++c) {
        auto& dst = in_[static_cast<size_t>(c)];
        if (c < chans)
            std::copy_n(ctx.destBuffer->getReadPointer(c, start), n, dst.data());
        else
            std::fill_n(dst.data(), n, 0.0f);
    }

    dsp_->compute(n, numIn_ > 0 ? inPtr_.data() : nullptr, outPtr_.data());

    for (int c = 0; c < chans; ++c) {
        // A mono program feeding a stereo buffer sends its one output to both sides; anything
        // past what the program produces is left as it was rather than zeroed, which is what a
        // plugin that does not touch a channel should do.
        const int from = numOut_ > 0 ? std::min(c, numOut_ - 1) : -1;
        if (from < 0) break;
        std::copy_n(out_[static_cast<size_t>(from)].data(), n,
                    ctx.destBuffer->getWritePointer(c, start));
    }
}

}  // namespace studio
