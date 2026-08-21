#include "FaustPlugin.h"
#include "Warnings.h"

#include "faust/dsp/interpreter-dsp.h"
#include "faust/dsp/poly-dsp.h"
#include "faust/gui/UI.h"

#include <algorithm>
#include <list>

// Faust's `GUI` base declares two statics and defines them nowhere: every architecture file in
// the distribution carries exactly these two lines, once per program. `poly-dsp.h` is what drags
// GUI in here — the voice group is a GUI client — so this is our architecture file.
//
// Without them the whole engine links until the last step and dies on one unresolved symbol with
// no obvious owner, which is how this was found.
std::list<GUI*> GUI::fGuiList;
ztimedmap GUI::gTimedZoneMap;

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

/**
 * How many notes an instrument can hold at once.
 *
 * Sixteen, and fixed: a voice is a whole copy of the program, so this is the cost of the module
 * whether or not anybody plays a chord. It is not in `module.yaml` because a module file
 * describes what a module IS, and how many fingers you have is not that.
 */
constexpr int VOICES = 16;

/**
 * The three names Faust's voice allocator DRIVES: pitch, velocity and the note itself.
 *
 * Filtered out of the parameter list on an instrument, and this is not cosmetic. They are real
 * controls in the source — `dsp.dsp` declares them, and it must — but on a polyphonic instrument
 * they belong to whichever voice is playing. Exposed as automatable parameters they would be a
 * fader fighting the voice allocator for the same zone, and the fader would win between notes.
 */
bool isVoiceControl(const std::string& label)
{
    return label == "freq" || label == "gain" || label == "gate" || label == "key"
           || label == "bend";
}

}  // namespace

juce::File FaustPlugin::faustLibrariesDir()
{
    const auto dir = juce::File::getSpecialLocation(juce::File::currentExecutableFile)
                         .getParentDirectory();
    // The four layouts a packaged app may use, PROBED rather than assumed — the same list, in
    // the same order and for the same reason, as hostcmd.rs's for the supervisor script: Tauri's
    // exact resource layout differs per platform and has moved before.
    for (const char* rel : {"faust-libs", "resources/faust-libs", "../Resources/faust-libs",
                            "../Resources/resources/faust-libs"}) {
        const auto candidate = dir.getChildFile(rel);
        if (candidate.isDirectory()) return candidate;
    }
    // The DEV tier: the folder the engine's own CMake fetched. It is inside a build directory and
    // does not travel, so reaching it in a shipped app would mean the staging above never ran.
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

    // No audio input means an INSTRUMENT, so it gets voices. The wrapper takes ownership of the
    // instance it is handed and clones it once per voice; `group: true` makes the program's own
    // controls shared across them, which is what "one Tine knob for the whole keyboard" means.
    if (numIn_ == 0) {
        poly_ = new mydsp_poly(dsp_, VOICES, /*control*/ false, /*group*/ true);
        run_ = poly_;
        numOut_ = poly_->getNumOutputs();
    } else {
        run_ = dsp_;
    }

    // Initialised at a placeholder rate so the control zones exist to be read; `initialise` does
    // it again with the real one, which is what the program actually runs at.
    run_->init(44100);

    Controls controls;
    run_->buildUserInterface(&controls);

    auto* um = getUndoManager();
    for (const auto& c : controls.entries) {
        if (poly_ != nullptr && isVoiceControl(c.label)) continue;
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
    // ONE of the two, never both: the voice group deallocates the instance it was handed. Then
    // the factory, which owns the code every voice runs.
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

// An instrument — `process` with no input — has to be run even on a track with nothing feeding
// it, or it never produces its first sample.
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

    // The scratch buffers, allocated once HERE and never in the callback. Faust is handed
    // separate input and output pointers because a program may read an input after writing an
    // output — in-place is not something a `.dsp` promises.
    const auto n = static_cast<size_t>(juce::jmax(info.blockSizeSamples, 1));
    in_.assign(static_cast<size_t>(juce::jmax(numIn_, 1)), std::vector<float>(n, 0.0f));
    out_.assign(static_cast<size_t>(juce::jmax(numOut_, 1)), std::vector<float>(n, 0.0f));
    // The per-SEGMENT pointer arrays, sized here so the note-accurate walk in renderWithNotes
    // allocates nothing on the audio thread.
    segIn_.assign(in_.size(), nullptr);
    segOut_.assign(out_.size(), nullptr);
}

void FaustPlugin::deinitialise() {}

void FaustPlugin::reset()
{
    if (run_ != nullptr) run_->instanceClear();
}

/**
 * Render one block, cutting it at every note so each one starts on ITS sample.
 *
 * The naive version applied every message at the block's start. At 5 ms that is inaudible on a
 * keyboard part and plainly wrong on a programmed roll: two hits 2 ms apart land together, and a
 * pattern quantised to 32nds at speed loses its swing to the block grid.
 *
 * So the block is walked in segments — apply what is due, compute up to the next event, repeat.
 * Faust's `compute` takes any length, so a segment is just a shorter call.
 *
 * NO ALLOCATION: the per-segment pointer arrays are sized in `initialise`, and the walk consumes
 * the message list in order rather than sorting a copy of it. Tracktion hands them in time order.
 */
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
    // A message's timestamp is absolute; `midiBufferOffset` is where this block starts on that
    // same clock. The inverse of what ExternalPlugin does on the way OUT — see its line that
    // builds `midiBufferOffset + samplePosition / sampleRate`.
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
    // A resonant filter's tail is the canonical denormal generator, and the symptom is an engine
    // that gets slower the longer it plays. Same reason GraphDspPlugin carries one.
    const juce::ScopedNoDenormals noDenormals;
    if (ctx.destBuffer == nullptr || run_ == nullptr) return;


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

    renderWithNotes(ctx, n);

    for (int c = 0; c < chans; ++c) {
        // A mono program feeding a stereo buffer sends its one output to both sides; anything
        // past what the program produces is left as it was rather than zeroed, which is what a
        // plugin that does not touch a channel should do.
        const int from = numOut_ > 0 ? juce::jmin(c, numOut_ - 1) : -1;
        if (from < 0) break;
        std::copy_n(out_[static_cast<size_t>(from)].data(), n,
                    ctx.destBuffer->getWritePointer(c, start));
    }
}

}  // namespace studio
