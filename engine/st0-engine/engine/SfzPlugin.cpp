#include "SfzPlugin.h"

#include <sfizz.hpp>

#include <iostream>

namespace studio {

// Renaming this renames the id a module.yaml may name a built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* SfzPlugin::xmlTypeName = "studio_sfz";

namespace {

// What a module names an instrument the SUPERVISOR downloads by, under this machine's `<state>/instruments`.
constexpr const char* INSTRUMENTS_REF = "@instruments/";

// The largest block the synth is prepared for: a bigger one is rendered in slices, never skipped.
constexpr int MAX_BLOCK = 4096;

// The volume's range in dB — enough to sit an instrument in a mix without leaving the fader's job to it.
constexpr float VOLUME_MIN_DB = -40.0f;
constexpr float VOLUME_MAX_DB = 12.0f;

juce::String dbToText(float v) { return juce::String(v, 1) + " dB"; }
float textToDb(const juce::String& s) { return s.getFloatValue(); }

}  // namespace

SfzPlugin::SfzPlugin(tracktion::engine::PluginCreationInfo info)
    : Plugin(std::move(info))
{
    auto* um = getUndoManager();
    volumeDbValue.referTo(state, juce::Identifier("volume"), um, 0.0f);
    volumeDb = addParam("volume", "Volume", {VOLUME_MIN_DB, VOLUME_MAX_DB}, dbToText, textToDb);
    volumeDb->attachToCurrentValue(volumeDbValue);
}

SfzPlugin::~SfzPlugin()
{
    stopTimer();
    notifyListenersOfDeletion();
    volumeDb->detachFromCurrentValue();
}

void SfzPlugin::restorePluginStateFromValueTree(const juce::ValueTree& v)
{
    tracktion::engine::copyPropertiesToCachedValues(v, volumeDbValue);
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
    sampleRate_ = info.sampleRate;
    out_.setSize(2, MAX_BLOCK, false, true, false);
    const juce::SpinLock::ScopedLockType sl(lock_);
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

juce::String SfzPlugin::instrumentPath() const
{
    const juce::SpinLock::ScopedLockType sl(lock_);
    return path_;
}

juce::File SfzPlugin::resolve(const juce::String& path)
{
    if (!path.startsWith(INSTRUMENTS_REF)) return juce::File(path);
    // The same state directory the scan cache and the supervisor use: $STUDIO_HOME, else ~/.st0.
    const auto env = juce::SystemStats::getEnvironmentVariable("STUDIO_HOME", {});
    const auto home = env.isNotEmpty() ? juce::File(env)
                                       : juce::File::getSpecialLocation(juce::File::userHomeDirectory).getChildFile(".st0");
    return home.getChildFile("instruments").getChildFile(path.substring(juce::String(INSTRUMENTS_REF).length()));
}

bool SfzPlugin::loadInstrument(const juce::String& path, juce::String& error)
{
    const auto file = resolve(path);
    stopTimer();
    waitingFor_ = {};
    // Not downloaded YET: the supervisor fetches every instrument when the engine starts (st0-supervisor docs/instruments.md).
    if (path.startsWith(INSTRUMENTS_REF) && !file.existsAsFile()) {
        std::cerr << "[sfz] " << path << " is not on this machine yet — loaded once the supervisor has fetched it\n";
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
    if (!loadNow(file, error)) std::cerr << "[sfz] " << error << "\n";
}

bool SfzPlugin::loadNow(const juce::File& file, juce::String& error)
{
    if (!file.existsAsFile()) {
        error = "sfz instrument not found: " + file.getFullPathName();
        return false;
    }
    // Built and loaded OFF the lock: preloading reads the head of every sample, which takes seconds.
    auto fresh = std::make_unique<sfz::Sfizz>();
    prepare(*fresh);
    if (!fresh->loadSfzFile(file.getFullPathName().toStdString()) || fresh->getNumRegions() == 0) {
        error = "sfz instrument has no playable region: " + file.getFullPathName();
        return false;
    }
    std::cerr << "[sfz] " << file.getFileName() << ": " << fresh->getNumRegions() << " regions\n";
    {
        const juce::SpinLock::ScopedLockType sl(lock_);
        std::swap(synth_, fresh);
        path_ = file.getFullPathName();
        freeWheeling_ = false;
    }
    // The previous synth dies here, on the message thread, never on the audio one.
    return true;
}

void SfzPlugin::applyToBuffer(const tracktion::engine::PluginRenderContext& ctx)
{
    if (ctx.destBuffer == nullptr) return;
    const int n = ctx.bufferNumSamples;
    const int start = ctx.bufferStartSample;
    const int chans = juce::jmin(ctx.destBuffer->getNumChannels(), 2);
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
            if (m.isNoteOn()) synth.noteOn(delay, m.getNoteNumber(), m.getVelocity());
            else if (m.isNoteOff()) synth.noteOff(delay, m.getNoteNumber(), m.getVelocity());
            else if (m.isController()) synth.cc(delay, m.getControllerNumber(), m.getControllerValue());
            else if (m.isPitchWheel()) synth.pitchWheel(delay, m.getPitchWheelValue() - 8192);
            else if (m.isChannelPressure()) synth.channelAftertouch(delay, m.getChannelPressureValue());
            else if (m.isAllNotesOff() || m.isAllSoundOff()) synth.allSoundOff();
        }
        float* bufs[2] = {out_.getWritePointer(0), out_.getWritePointer(1)};
        synth.renderBlock(bufs, (size_t)len, 1);
        for (int c = 0; c < chans; ++c)
            ctx.destBuffer->copyFrom(c, start + done, out_, c, 0, len);
    }
}

}  // namespace studio
