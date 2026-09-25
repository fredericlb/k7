#include "FaustPlugin.h"
#include "Warnings.h"

#include "faust/dsp/interpreter-dsp.h"
#include "faust/dsp/poly-dsp.h"
#include "faust/gui/UI.h"

#include <algorithm>
#include <list>

// Faust defines these two statics in no library, so every architecture file carries them; this file is ours.
std::list<GUI*> GUI::fGuiList;
ztimedmap GUI::gTimedZoneMap;

namespace studio {

namespace te = tracktion::engine;

// Renaming this renames the id a module.yaml may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* FaustPlugin::xmlTypeName = "studio_faust";

namespace {

/** The controls a program declares, in the order Faust reports them; groups are IGNORED (docs/faust.md). */
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
    // A bargraph is an OUTPUT: exposing one would let a fader write where only the DSP should.
    void addHorizontalBargraph(const char*, FAUSTFLOAT*, FAUSTFLOAT, FAUSTFLOAT) override {}
    void addVerticalBargraph(const char*, FAUSTFLOAT*, FAUSTFLOAT, FAUSTFLOAT) override {}
    void addSoundfile(const char*, const char*, Soundfile**) override {}
};

/** How many notes an instrument holds at once — fixed, since a voice is a whole copy of the program. */
constexpr int VOICES = 16;

/** The names the voice allocator DRIVES: exposed as parameters, a fader would fight it for the same zone. */
bool isVoiceControl(const std::string& label)
{
    return label == "freq" || label == "gain" || label == "gate" || label == "key"
           || label == "bend";
}

}  // namespace

juce::File FaustPlugin::faustLibrariesDir()
{
    // Named by the host when there is no executable to look beside: the Android app, which unpacks them (docs/android.md).
    if (const auto named = juce::SystemStats::getEnvironmentVariable("STUDIO_FAUST_LIBS", {}); named.isNotEmpty())
        return juce::File{named};
    const auto dir = juce::File::getSpecialLocation(juce::File::currentExecutableFile)
                         .getParentDirectory();
    // The four layouts a packaged app may use, PROBED rather than assumed, as hostcmd.rs does.
    for (const char* rel : {"faust-libs", "resources/faust-libs", "../Resources/faust-libs",
                            "../Resources/resources/faust-libs"}) {
        const auto candidate = dir.getChildFile(rel);
        if (candidate.isDirectory()) return candidate;
    }
    // The DEV tier, inside a build directory: reaching it in a shipped app means the staging never ran.
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
    // COMPILED HERE: the parameters below are the program's, and Tracktion creates them nowhere else.
    factory_ = createInterpreterDSPFactoryFromString("studio", source_, 2, argv, error);
    if (factory_ == nullptr) {
        // Verbatim: Faust names the line and the symbol, and a paraphrase points at the wrong place.
        warn("faust: " + error);
        return;
    }

    dsp_ = factory_->createDSPInstance();
    numIn_ = dsp_->getNumInputs();
    numOut_ = dsp_->getNumOutputs();

    // No audio input means an INSTRUMENT, so it gets voices; the wrapper takes ownership of the instance.
    if (numIn_ == 0) {
        // NEITHER flag is optional: false and true respectively are two silent instruments (docs/faust.md).
        poly_ = new mydsp_poly(dsp_, VOICES, /*control*/ true, /*group*/ false);
        run_ = poly_;
        numOut_ = poly_->getNumOutputs();
    } else {
        run_ = dsp_;
    }

    // A placeholder rate, only so the control zones exist to be read; `initialise` does it again for real.
    run_->init(44100);

    Controls controls;
    run_->buildUserInterface(&controls);

    // One parameter per NAME, in first-seen order, holding every voice's zone for it (docs/faust.md).
    std::vector<Controls::Entry> unique;
    std::vector<std::vector<float*>> zonesFor;
    for (const auto& c : controls.entries) {
        if (poly_ != nullptr && isVoiceControl(c.label)) continue;
        auto it = std::find_if(unique.begin(), unique.end(),
                               [&](const Controls::Entry& e) { return e.label == c.label; });
        if (it == unique.end()) {
            unique.push_back(c);
            zonesFor.push_back({c.zone});
        } else {
            zonesFor[(size_t)(it - unique.begin())].push_back(c.zone);
        }
    }

    auto* um = getUndoManager();
    for (size_t i = 0; i < unique.size(); ++i) {
        const auto& c = unique[i];
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
        zones_.push_back(std::move(zonesFor[i]));
    }
}

FaustPlugin::~FaustPlugin()
{
    notifyListenersOfDeletion();
    for (auto& p : params_) p->detachFromCurrentValue();
    // ONE of the two, never both: the voice group deallocates the instance it was handed.
    if (poly_ != nullptr)
        delete poly_;
    else
        delete dsp_;
    poly_ = nullptr;
    dsp_ = nullptr;
    run_ = nullptr;
    if (factory_ != nullptr) deleteInterpreterDSPFactory(factory_);
}

bool FaustPlugin::takesAudioInput() { return numIn_ > 0; }

// An instrument must run even on a track with nothing feeding it, or it never makes its first sample.
bool FaustPlugin::producesAudioWhenNoAudioInput() { return numIn_ == 0; }

bool FaustPlugin::takesMidiInput() { return poly_ != nullptr; }

int FaustPlugin::getNumOutputChannelsGivenInputs(int n)
{
    if (run_ == nullptr) return juce::jmin(n, 2);
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
    if (run_ == nullptr) return;
    run_->init(static_cast<int>(info.sampleRate));

    // The scratch buffers, allocated HERE and never in the callback; in-place is not something a `.dsp` promises.
    const auto n = static_cast<size_t>(juce::jmax(info.blockSizeSamples, 1));
    in_.assign(static_cast<size_t>(juce::jmax(numIn_, 1)), std::vector<float>(n, 0.0f));
    out_.assign(static_cast<size_t>(juce::jmax(numOut_, 1)), std::vector<float>(n, 0.0f));
    // The per-SEGMENT pointer arrays, sized here so renderWithNotes allocates nothing on the audio thread.
    segIn_.assign(in_.size(), nullptr);
    segOut_.assign(out_.size(), nullptr);
}

void FaustPlugin::deinitialise() {}

void FaustPlugin::reset()
{
    if (run_ != nullptr) run_->instanceClear();
}

/** Render one block in SEGMENTS, so each note starts on its own sample and nothing allocates (docs/faust.md). */
void FaustPlugin::renderWithNotes(const te::PluginRenderContext& ctx, int n)
{
    auto segment = [&](int from, int len) {
        if (len <= 0) return;
        for (int c = 0; c < numIn_; ++c) segIn_[(size_t)c] = in_[(size_t)c].data() + from;
        for (int c = 0; c < numOut_; ++c) segOut_[(size_t)c] = out_[(size_t)c].data() + from;
        run_->compute(len, numIn_ > 0 ? segIn_.data() : nullptr, segOut_.data());
    };

    if (poly_ == nullptr || ctx.bufferForMidiMessages == nullptr) {
        segment(0, n);
        return;
    }

    const double rate = sampleRate > 0.0 ? sampleRate : 48000.0;
    // A timestamp is absolute and `midiBufferOffset` is this block's start on the same clock.
    const auto offsetOf = [&](const juce::MidiMessage& m) {
        const double secs = m.getTimeStamp() - ctx.midiBufferOffset;
        return juce::jlimit(0, n, static_cast<int>(secs * rate));
    };

    int done = 0;
    auto it = ctx.bufferForMidiMessages->begin();
    const auto end = ctx.bufferForMidiMessages->end();
    while (done < n) {
        int next = n;
        while (it != end) {
            const int at = offsetOf(*it);
            if (at > done) {
                next = juce::jmin(n, at);
                break;
            }
            const auto& m = *it;
            if (m.isNoteOn())
                poly_->keyOn(m.getChannel(), m.getNoteNumber(), m.getVelocity());
            else if (m.isNoteOff())
                poly_->keyOff(m.getChannel(), m.getNoteNumber(), m.getVelocity());
            else if (m.isAllNotesOff() || m.isAllSoundOff())
                poly_->allNotesOff(true);
            ++it;
        }
        segment(done, next - done);
        done = next;
    }
}

void FaustPlugin::applyToBuffer(const te::PluginRenderContext& ctx)
{
    // A resonant tail is the canonical denormal generator, and the symptom is an engine that slows down.
    const juce::ScopedNoDenormals noDenormals;
    if (ctx.destBuffer == nullptr || run_ == nullptr) return;


    const int n = ctx.bufferNumSamples;
    const int start = ctx.bufferStartSample;
    if (n <= 0 || n > static_cast<int>(in_.empty() ? 0 : in_[0].size())) return;

    // The parameters, read once per block — past this loop the audio path touches no Tracktion object.
    for (size_t i = 0; i < zones_.size(); ++i) {
        const float v = params_[i]->getCurrentValue();
        // EVERY voice that declares this control, not just one — sixteen stores, and no allocation.
        for (float* zone : zones_[i]) *zone = v;
    }

    const int chans = ctx.destBuffer->getNumChannels();
    for (int c = 0; c < numIn_; ++c) {
        auto& dst = in_[static_cast<size_t>(c)];
        if (c < chans)
            std::copy_n(ctx.destBuffer->getReadPointer(c, start), n, dst.data());
        else
            std::fill_n(dst.data(), n, 0.0f);
    }

    renderWithNotes(ctx, n);

    for (int c = 0; c < chans; ++c) {
        // A mono program feeds both sides; past what it produces a channel is LEFT as it was, not zeroed.
        const int from = numOut_ > 0 ? juce::jmin(c, numOut_ - 1) : -1;
        if (from < 0) break;
        std::copy_n(out_[static_cast<size_t>(from)].data(), n,
                    ctx.destBuffer->getWritePointer(c, start));
    }
}

}  // namespace studio
