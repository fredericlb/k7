#include "SfzPlugin.h"
#include "InstrumentStatus.h"

#include "LoadGuard.h"   // studioStateDir, and an instrument that crashes the engine as it loads is pinned on its file

#include <sfizz.hpp>

#include <iostream>

namespace studio {

// Renaming this renames the id a module.k7x may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* SfzPlugin::xmlTypeName = "studio_sfz";

namespace {

// What a module names an instrument the SUPERVISOR downloads by, under this machine's `<state>/instruments`.
constexpr const char* INSTRUMENTS_REF = "@instruments/";

// The largest block the synth is prepared for: a bigger one is rendered in slices, never skipped.
constexpr int MAX_BLOCK = 4096;

// The volume's range in dB — enough to sit an instrument in a mix without leaving the fader's job to it.
constexpr float VOLUME_MIN_DB = -40.0f;
constexpr float VOLUME_MAX_DB = 12.0f;

// A key's gain, in dB: a pad brought up to the front of a kit, or taken well down under it.
constexpr float KEY_GAIN_MIN_DB = -24.0f;
constexpr float KEY_GAIN_MAX_DB = 12.0f;
constexpr int KEYS = 128;

juce::String dbToText(float v) { return juce::String(v, 1) + " dB"; }
juce::String muteToText(float v) { return v >= 0.5f ? "muted" : "on"; }
float textToMute(const juce::String& s) { return s.trim().equalsIgnoreCase("muted") || s.getFloatValue() >= 0.5f ? 1.0f : 0.0f; }
float textToDb(const juce::String& s) { return s.getFloatValue(); }

}  // namespace

SfzPlugin::SfzPlugin(tracktion::engine::PluginCreationInfo info)
    : Plugin(std::move(info))
{
    auto* um = getUndoManager();
    volumeDbValue.referTo(state, juce::Identifier("volume"), um, 0.0f);
    volumeDb = addParam("volume", "Volume", {VOLUME_MIN_DB, VOLUME_MAX_DB}, dbToText, textToDb);
    volumeDb->attachToCurrentValue(volumeDbValue);
    for (int k = 0; k < KEYS; ++k) {
        const juce::String id = "key" + juce::String(k);
        auto value = std::make_unique<juce::CachedValue<float>>();
        value->referTo(state, juce::Identifier(id), um, 0.0f);
        auto param = addParam(id, "Key " + juce::String(k), {KEY_GAIN_MIN_DB, KEY_GAIN_MAX_DB}, dbToText, textToDb);
        param->attachToCurrentValue(*value);
        keyGains.push_back(param);
        keyGainValues.push_back(std::move(value));
    }
    for (int k = 0; k < KEYS; ++k) {
        const juce::String id = "mute" + juce::String(k);
        auto value = std::make_unique<juce::CachedValue<float>>();
        value->referTo(state, juce::Identifier(id), um, 0.0f);
        auto param = addParam(id, "Mute " + juce::String(k), {0.0f, 1.0f}, muteToText, textToMute);
        param->attachToCurrentValue(*value);
        keyMutes.push_back(param);
        keyMuteValues.push_back(std::move(value));
    }
}

SfzPlugin::~SfzPlugin()
{
    // A load in flight writes into this plugin, so it is waited for; one not started is dropped.
    loader_.removeAllJobs(true, -1);
    stopTimer();
    notifyListenersOfDeletion();
    volumeDb->detachFromCurrentValue();
    for (auto& p : keyGains) p->detachFromCurrentValue();
    for (auto& p : keyMutes) p->detachFromCurrentValue();
}

void SfzPlugin::restorePluginStateFromValueTree(const juce::ValueTree& v)
{
    tracktion::engine::copyPropertiesToCachedValues(v, volumeDbValue);
    for (auto& value : keyGainValues) tracktion::engine::copyPropertiesToCachedValues(v, *value);
    for (auto& value : keyMuteValues) tracktion::engine::copyPropertiesToCachedValues(v, *value);
    for (auto p : getAutomatableParameters())
        p->updateFromAttachedValue();
}

juce::ValueTree SfzPlugin::create()
{
    juce::ValueTree v(tracktion::engine::IDs::PLUGIN);
    v.setProperty(tracktion::engine::IDs::type, xmlTypeName, nullptr);
    return v;
}

void SfzPlugin::prepare(sfz::Sfizz& synth) const
{
    synth.setSampleRate((float)sampleRate_);
    synth.setSamplesPerBlock(MAX_BLOCK);
}

void SfzPlugin::initialise(const tracktion::engine::PluginInitialisationInfo& info)
{
    out_.setSize(2 * pairs_, MAX_BLOCK, false, true, false);
    const juce::SpinLock::ScopedLockType sl(lock_);
    sampleRate_ = info.sampleRate;
    if (synth_ != nullptr) prepare(*synth_);
}

void SfzPlugin::deinitialise() {}

void SfzPlugin::reset()
{
    silencePending_ = true;
}

void SfzPlugin::midiPanic()
{
    silencePending_ = true;
}

juce::File SfzPlugin::resolve(const juce::String& path)
{
    if (!path.startsWith(INSTRUMENTS_REF)) return juce::File(path);
    // The same state directory the scan cache and the supervisor use.
    return studioStateDir().getChildFile("instruments").getChildFile(path.substring(juce::String(INSTRUMENTS_REF).length()));
}

bool SfzPlugin::installed(const juce::String& path)
{
    const auto file = resolve(path);
    if (!path.startsWith(INSTRUMENTS_REF)) return file.existsAsFile();
    // The marker is written last, once the folder is whole (k7-supervisor docs/instruments.md).
    const auto name = path.substring(juce::String(INSTRUMENTS_REF).length()).upToFirstOccurrenceOf("/", false, false);
    const auto marker = resolve(juce::String(INSTRUMENTS_REF) + name).getChildFile(".k7-archive");
    return name.isNotEmpty() && marker.existsAsFile() && file.existsAsFile();
}

bool instrumentInstalled(const std::string& ref) { return SfzPlugin::installed(juce::String::fromUTF8(ref.c_str())); }

bool SfzPlugin::loadInstrument(const juce::String& path, juce::String& error, const std::string& subject)
{
    const auto file = resolve(path);
    subject_ = subject;
    origin_ = warningOrigin();
    stopTimer();
    waitingFor_ = {};
    // Not here: downloaded by the supervisor, and loaded the moment it lands (k7-supervisor docs/instruments.md).
    if (path.startsWith(INSTRUMENTS_REF) && !file.existsAsFile()) {
        std::cerr << "[sfz] " << path << " is not on this machine — loaded once it is downloaded\n";
        waitingFor_ = path;
        startTimer(2000);
        return true;
    }
    return loadNow(file, error);
}

void SfzPlugin::timerCallback()
{
    if (waitingFor_.isEmpty() || !resolve(waitingFor_).existsAsFile()) return;
    stopTimer();
    juce::String error;
    const auto file = resolve(waitingFor_);
    waitingFor_ = {};
    // Said for the project that asked for it, as if the build that named it were still running.
    const WarningOriginScope scope{origin_};
    if (!loadNow(file, error)) warn(error.toStdString(), subject_);
}

bool SfzPlugin::loadNow(const juce::File& file, juce::String& error)
{
    if (!file.existsAsFile()) {
        error = "sfz instrument not found: " + file.getFullPathName();
        return false;
    }
    if (std::string why; loadQuarantined(file.getFullPathName().toStdString(), why)) {
        error = juce::String(why);
        return false;
    }
    double rate = 0.0;
    {
        const juce::SpinLock::ScopedLockType sl(lock_);
        rate = sampleRate_;
    }
    // Queued, not run: preloading reads the head of every sample, seconds the message thread owes every session.
    const int gen = ++loadGen_;
    ++loadsPending_;
    loader_.addJob([this, file, gen, rate, outs = keyOuts_, subject = subject_, origin = warningOrigin()]() mutable {
        const WarningOriginScope scope{origin};
        // Caught here, or a bad_alloc on a huge instrument skips the count an offline render waits on.
        try {
            if (gen == loadGen_.load()) loadOnWorker(file, gen, rate, std::move(outs), subject);
        } catch (const std::exception& e) {
            warn(std::string("could not load the sfz instrument: ") + e.what(), subject);
        }
        --loadsPending_;
    });
    return true;
}

void SfzPlugin::loadOnWorker(const juce::File& file, int gen, double rate, std::vector<std::pair<int, int>> keyOuts,
                             const std::string& subject)
{
    const auto path = file.getFullPathName().toStdString();
    auto fresh = std::make_unique<sfz::Sfizz>();
    fresh->setSampleRate((float)rate);
    fresh->setSamplesPerBlock(MAX_BLOCK);
    bool loaded = false;
    {
        const LoadGuard guard{"instrument", path};
        loaded = fresh->loadSfzFile(path);
    }
    if (!loaded || fresh->getNumRegions() == 0) {
        warn("sfz instrument has no playable region: " + path, subject);
        return;
    }
    std::cerr << "[sfz] " << file.getFileName() << ": " << fresh->getNumRegions() << " regions\n";
    // Each routed key's output, off the lock and before the synth goes live: setting one may add its buses.
    for (const auto& [key, pair] : keyOuts) fresh->setKeyOutput(key, pair);
    {
        const juce::SpinLock::ScopedLockType sl(lock_);
        // A later request superseded this one while it loaded: the newer synth is the one to keep.
        if (gen != loadGen_.load()) return;
        // The graph was prepared at another rate while this one loaded.
        if (sampleRate_ != rate) prepare(*fresh);
        std::swap(synth_, fresh);
        path_ = file.getFullPathName();
        freeWheeling_ = false;
    }
    // The previous synth dies here, on the loader thread, never on the audio one.
}

void SfzPlugin::getChannelNames(juce::StringArray* ins, juce::StringArray* outs)
{
    if (ins != nullptr) {
        ins->add("Left");
        ins->add("Right");
    }
    if (outs != nullptr)
        for (int c = 0; c < 2 * pairs_; ++c)
            outs->add((c % 2 == 0 ? "Left " : "Right ") + juce::String(c / 2 + 1));
}

void SfzPlugin::setKeyOutputs(const std::vector<std::pair<int, int>>& noteToPair)
{
    keyOuts_.clear();
    pairs_ = 1;
    for (const auto& [note, pair] : noteToPair)
        if (note >= 0 && note < KEYS && pair >= 0 && pair < MAX_PAIRS) {
            keyOuts_.emplace_back(note, pair);
            pairs_ = std::max(pairs_, pair + 1);
        }
}

void SfzPlugin::applyToBuffer(const tracktion::engine::PluginRenderContext& ctx)
{
    // An offline render has no one to hear a late instrument: it waits for the load, which runs on its own thread.
    if (ctx.isRendering)
        while (loadsPending_.load() > 0) juce::Thread::sleep(5);
    if (ctx.destBuffer == nullptr) return;
    const int n = ctx.bufferNumSamples;
    const int start = ctx.bufferStartSample;
    // Every pair the buffer carries: two on a track, all of them in a RackType (docs/tapOutputs.md).
    const int rendered = juce::jmin(out_.getNumChannels(), 2 * pairs_);
    const int chans = juce::jmin(ctx.destBuffer->getNumChannels(), rendered);
    // An instrument: whatever the track carried in is replaced, by the synth or by silence.
    for (int c = 0; c < ctx.destBuffer->getNumChannels(); ++c) ctx.destBuffer->clear(c, start, n);

    const juce::SpinLock::ScopedTryLockType sl(lock_);
    if (!sl.isLocked() || synth_ == nullptr || n <= 0) return;
    auto& synth = *synth_;

    if (silencePending_.exchange(false)) synth.allSoundOff();
    // A render runs faster than the disk can stream: free-wheeling loads each sample before its note sounds.
    if (ctx.isRendering != freeWheeling_) {
        freeWheeling_ = ctx.isRendering;
        if (freeWheeling_) synth.enableFreeWheeling();
        else synth.disableFreeWheeling();
    }
    synth.setVolume(volumeDbValue.get());
    for (int k = 0; k < KEYS; ++k) synth.setKeyGain(k, keyGains[(size_t)k]->getCurrentValue());

    // Sliced to the prepared size; each message goes to the slice it falls in, at its sample.
    const double rate = sampleRate > 0.0 ? sampleRate : sampleRate_;
    auto it = ctx.bufferForMidiMessages != nullptr ? ctx.bufferForMidiMessages->begin() : nullptr;
    const auto end = ctx.bufferForMidiMessages != nullptr ? ctx.bufferForMidiMessages->end() : nullptr;
    for (int done = 0; done < n; done += MAX_BLOCK) {
        const int len = juce::jmin(MAX_BLOCK, n - done);
        for (; it != end; ++it) {
            const int at = juce::jlimit(0, n - 1, (int)((it->getTimeStamp() - ctx.midiBufferOffset) * rate));
            if (at >= done + len) break;
            const auto& m = *it;
            const int delay = at - done;
            // A muted key's note-on is dropped here; its note-off still passes, so a voice started before the mute ends.
            if (m.isNoteOn()) {
                if (keyMutes[(size_t)m.getNoteNumber()]->getCurrentValue() < 0.5f)
                    synth.noteOn(delay, m.getNoteNumber(), m.getVelocity());
            }
            else if (m.isNoteOff()) synth.noteOff(delay, m.getNoteNumber(), m.getVelocity());
            else if (m.isController()) synth.cc(delay, m.getControllerNumber(), m.getControllerValue());
            else if (m.isPitchWheel()) synth.pitchWheel(delay, m.getPitchWheelValue() - 8192);
            else if (m.isChannelPressure()) synth.channelAftertouch(delay, m.getChannelPressureValue());
            else if (m.isAllNotesOff() || m.isAllSoundOff()) synth.allSoundOff();
        }
        float* bufs[2 * MAX_PAIRS] = {};
        for (int c = 0; c < rendered; ++c) bufs[c] = out_.getWritePointer(c);
        synth.renderBlock(bufs, (size_t)len, rendered / 2);
        for (int c = 0; c < chans; ++c)
            ctx.destBuffer->copyFrom(c, start + done, out_, c, 0, len);
    }
}

}  // namespace studio
