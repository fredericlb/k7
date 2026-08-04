// Recording: live-input wiring, record arming, take naming, and the transport
// listener that catches a finished take. These stay EngineHost member functions
// (relocated here) rather than a separate collaborator: they read impl_->session(session).current, which
// lives on EngineHost, not Impl — a class here would buy nothing but a back-pointer.
// RecordListener is already a friend of EngineHost (see EngineHost.h).

#include "EngineHost.h"

#include "EngineTypes.h"       // Tracktion/JUCE + the te/tt/fs aliases
#include "EngineHostImpl.h"    // struct EngineHost::Impl
#include "EditBuilder.h"       // trackById
#include "AudioInputs.h"       // findWaveInput / monitorModeOf / findTrackInput

#include <algorithm>
#include <iostream>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace studio {

// The end of a take: Tracktion has closed the file and made a clip, so we rename the file to what prepareTakes(session)
// promised and hand the brain the track, path and position. Then we DROP Tracktion's clip — the brain owns what
// is on a track and will declare this take and send the project back, so leaving it would double the take.
struct RecordListener : public te::TransportControl::Listener {
    // Bound to ONE session — the one whose transport it was attached to. A take that
    // finished belongs to the project that was recording it, and with N projects there is
    // no "the" edit to look it up in.
    RecordListener(EngineHost& h, std::string s) : host(h), session(std::move(s)) {}

    void recordingFinished(te::InputDeviceInstance&, te::EditItemID targetID,
                           const juce::ReferenceCountedArray<te::Clip>& clips) override {
        auto* edit = host.impl_->session(session).edit.get();
        if (edit == nullptr || clips.isEmpty()) return;

        // targetID is engine-side and the doc speaks track ids, so map back the way trackById maps forward.
        std::string trackId;
        for (const auto& t : host.current(session).tracks)
            if (auto* tr = trackById(*edit, t.id, host.current(session)); tr && tr->itemID == targetID) {
                trackId = t.id;
                break;
            }
        if (trackId.empty()) return;

        auto take = host.impl_->session(session).pendingTakes.find(trackId);
        for (auto* clip : clips) {
            auto* wave = dynamic_cast<te::WaveAudioClip*>(clip);
            if (wave == nullptr) continue;
            auto file = wave->getSourceFileReference().getFile();
            const auto pos = clip->getPosition();
            const double start = pos.time.getStart().inSeconds();
            const double length = pos.time.getLength().inSeconds();

            // Rename within the directory prepareTakes(session) aimed the device at, so this is a metadata move, never a copy.
            if (take != host.impl_->session(session).pendingTakes.end() && file.existsAsFile()) {
                auto dest = file.getParentDirectory()
                                .getChildFile(juce::String(take->second) + file.getFileExtension());
                if (dest != file && (!dest.existsAsFile() || dest.deleteFile())) {
                    if (file.moveFileTo(dest)) file = dest;
                    else std::cerr << "[rec] could not rename take to "
                                   << dest.getFullPathName() << " — keeping "
                                   << file.getFullPathName() << '\n';
                }
            }

            clip->removeFromParent();   // the brain re-adds it, from CUE

            std::cerr << "[rec] track '" << trackId << "' recorded "
                      << file.getFullPathName() << " (" << start << "s +" << length << "s)\n";
            if (host.impl_->recordedCb)
                host.impl_->recordedCb(trackId, file.getFullPathName().toStdString(), start, length);
        }
        if (take != host.impl_->session(session).pendingTakes.end()) host.impl_->session(session).pendingTakes.erase(take);
    }

    EngineHost& host;
    std::string session;
};

// Re-attach the record listener to the current edit's transport — a fresh Edit brings a fresh one, taking the
// previous listener list with it. A thin wrapper so applyFull(), where RecordListener is incomplete, can create
// it here where the type is complete.
void EngineHost::attachRecordListener(const std::string& session) {
    if (!impl_->session(session).recordListener) impl_->session(session).recordListener = std::make_unique<RecordListener>(*this, session);
    if (auto* tc = impl_->transport(session)) tc->addListener(impl_->session(session).recordListener.get());
}

// Wire one track to its declared input, replacing whatever it had; clearing first makes it idempotent.
// NOTE: monitor mode is a property of the DEVICE, not the target — Tracktion has one mode per input, so two
// tracks on one physical input share it and the last applied wins. A real limit of this mapping, not an
// oversight: per-track monitoring would need one device per track.
void EngineHost::applyTrackInput(const std::string& session, const TrackDoc& t) {
    if (!impl_->session(session).edit) return;
    auto* track = trackById(*impl_->session(session).edit, t.id, impl_->session(session).current);
    if (track == nullptr) return;

    // Drop any previous assignment for this track, so a changed or removed input never keeps feeding it.
    impl_->session(session).edit->getEditInputDevices().clearAllInputs(*track, nullptr);
    if (t.inputChannels.empty()) return;

    auto* ctx = impl_->session(session).edit->getCurrentPlaybackContext();
    if (ctx == nullptr) return;   // no context yet — applyAllTrackInputs runs after one exists

    auto* dev = findWaveInput(impl_->engine, t.inputChannels);
    if (dev == nullptr) {
        std::cerr << "[input] track '" << t.id << "': no interface input on channel(s)";
        for (int ch : t.inputChannels) std::cerr << ' ' << ch;
        std::cerr << " — leaving it silent\n";
        return;
    }
    dev->setEnabled(true);   // a disabled device yields no instance to target

    auto* instance = ctx->getInputFor(dev);
    if (instance == nullptr) {
        std::cerr << "[input] track '" << t.id << "': '" << dev->getName()
                  << "' has no instance on this playback context\n";
        return;
    }
    if (auto res = instance->setTarget(track->itemID, true, nullptr); !res)
        std::cerr << "[input] track '" << t.id << "': " << res.error() << '\n';
    else
        std::cerr << "[input] track '" << t.id << "' <- '" << dev->getName()
                  << "' monitor=" << t.monitor << " gain=" << t.inputGain << "dB\n";
    dev->setMonitorMode(monitorModeOf(t.monitor));
    // Trim, applied at the DEVICE like the monitor mode above — so the same caveat holds: two tracks sharing
    // one physical input share its gain, and the last applied wins.
    dev->setInputGainDb(static_cast<float>(t.inputGain));
}

void EngineHost::applyAllTrackInputs(const std::string& session, const ProjectDoc& doc) {
    for (const auto& t : doc.tracks) applyTrackInput(session, t);
}

// --- Record arming -----------------------------------------------------------

EngineHost::ArmResult EngineHost::setArmed(const std::string& session, const std::string& trackId,
                                           std::optional<bool> armed) {
    // Every refusal names what is actually wrong, because the ways this fails look identical from the UI: no such
    // track, no input in the song, an input this rig doesn't have, or nothing loaded yet.
    const auto refuse = [](std::string why) { return ArmResult{false, false, std::move(why)}; };
    if (!impl_->session(session).edit) return refuse("no project loaded");

    const TrackDoc* td = nullptr;
    for (const auto& t : impl_->session(session).current.tracks)
        if (t.id == trackId) { td = &t; break; }
    // Deliberately NOT the brain's wording: reaching here means the brain found the track and the engine's loaded
    // song disagrees — a skew, not a typo — and the two are easier to tell apart if they don't say the same thing.
    if (td == nullptr)
        return refuse("the engine's loaded song has no track \"" + trackId
                      + "\" — send the project first");
    if (td->inputChannels.empty())
        return refuse("track \"" + trackId + "\" has no input — nothing to record");

    auto ti = findTrackInput(impl_->session(session).edit.get(), impl_->engine, impl_->session(session).current, trackId);
    if (ti.instance == nullptr) {
        // The song declares an input this interface doesn't offer; applyTrackInput already warned, so arming would
        // capture nothing.
        std::string chans;
        for (int ch : td->inputChannels) chans += ' ' + std::to_string(ch);
        return refuse("track \"" + trackId + "\": no interface input on channel(s)" + chans);
    }

    const bool want = armed.value_or(!ti.instance->isRecordingEnabled(ti.track->itemID));
    // Refuse here rather than at stop: a take that records fine and then has nowhere to go is worse than never
    // arming. Disarming stays allowed — it can only make things safer.
    if (want && impl_->session(session).current.recordDir.empty())
        return refuse("this song has no clips/ directory to record into");

    ti.instance->setRecordingEnabled(ti.track->itemID, want);
    std::cerr << "[rec] track '" << trackId << "' " << (want ? "armed" : "disarmed") << '\n';
    return {true, want, {}};
}

std::vector<std::string> EngineHost::armedTracks(const std::string& session) const {
    std::vector<std::string> out;
    if (!impl_->session(session).edit) return out;
    for (const auto& t : impl_->session(session).current.tracks) {
        auto ti = findTrackInput(impl_->session(session).edit.get(), impl_->engine, impl_->session(session).current, t.id);
        if (ti.instance != nullptr && ti.instance->isRecordingEnabled(ti.track->itemID))
            out.push_back(t.id);
    }
    return out;
}

// Peak dB per channel set, asked of the INTERFACE rather than of the song — see the header.
//
// Two things have to be true before a device measures anything, and enabling it is only the first. The second is
// that it has an INSTANCE on the playback context: WaveInputDevice::consumeNextAudioBlock feeds levelMeasurer
// from inside its loop over instances, so a device with none never touches it however enabled it is — and the
// context only creates instances for the devices that were already enabled when it was built. An input no track
// records is exactly that case, which is the whole point of this panel, so we add the instance ourselves. Once
// per device: addWaveInputDeviceInstance reallocates the graph, which is not something a 10 Hz poll may do.
// Where one 1-based interface channel actually lives: the device carrying it, and its index INSIDE that device.
//
// Deliberately not findWaveInput, which matches a device only when its channel list is exactly the one asked for.
// That is the right rule for ROUTING a track (you take a device whole, mono or stereo), and the wrong one here:
// an interface's inputs are usually paired into stereo devices, so asking for channel 2 alone matches nothing at
// all and reads as silence — a meter that says "nothing plugged in" because the rig pairs its inputs.
static std::pair<te::WaveInputDevice*, int> channelTap(te::Engine& engine, int channel) {
    for (auto* dev : engine.getDeviceManager().getWaveInputDevices()) {
        if (dev == nullptr) continue;
        const auto& ch = dev->getChannels();
        for (int i = 0; i < static_cast<int>(ch.size()); ++i)
            if (ch[i].indexInDevice == channel - 1) return {dev, i};
    }
    return {nullptr, 0};
}

std::vector<EngineHost::ChannelPitch>
EngineHost::channelPitches(const std::vector<std::vector<int>>& channelSets) {
    // The tap attaches on the first ask and stays: a second audio callback is cheap, and detaching it on every
    // poll would restart the ring buffers and mean no reading ever settled.
    if (!impl_->tunerAttached) {
        impl_->engine.getDeviceManager().deviceManager.addAudioCallback(&impl_->tuner);
        impl_->tunerAttached = true;
    }

    // Watch exactly what was asked for, so a closed panel stops costing anything on the audio thread. The FIRST
    // channel of each set: a stereo pair carries one instrument, and tuning both halves would be the same note.
    std::vector<int> watch;
    for (const auto& set : channelSets)
        if (!set.empty()) watch.push_back(set.front());
    impl_->tuner.watch(watch);

    std::vector<ChannelPitch> out(channelSets.size());
    for (size_t i = 0; i < channelSets.size(); ++i) {
        if (channelSets[i].empty()) continue;
        const auto p = impl_->tuner.pitchOf(channelSets[i].front());
        out[i] = {p.hz, p.clarity};
    }
    return out;
}

std::vector<EngineHost::InputDeviceInfo> EngineHost::inputDevices() const {
    std::vector<InputDeviceInfo> out;
    for (auto* dev : impl_->engine.getDeviceManager().getWaveInputDevices()) {
        if (dev == nullptr) continue;
        InputDeviceInfo info;
        info.name = dev->getName().toStdString();
        info.enabled = dev->isEnabled();
        for (const auto& c : dev->getChannels()) info.channels.push_back(c.indexInDevice + 1);
        out.push_back(std::move(info));
    }
    return out;
}

std::vector<EngineHost::ChannelLevel>
EngineHost::channelLevelsDb(const std::vector<std::vector<int>>& channelSets) {
    std::vector<ChannelLevel> out(channelSets.size());
    // MACHINE-level, so it belongs to no session — but it still needs A playback context to
    // reach the input device instances, and with N sessions there is no "the" one. Any will
    // do: the instances it looks up are the DEVICE's, shared by every context, which is the
    // same reason inputClients live on Impl and not in a session.
    te::EditPlaybackContext* ctx = nullptr;
    for (const auto& sid : impl_->ids())
        if (auto& e = impl_->session(sid).edit) {
            ctx = e->getCurrentPlaybackContext();
            if (ctx != nullptr) break;
        }
    // Read+clear each (device, index) at most once: two ports on the two halves of one stereo device are
    // different indices and independent, but two asking the SAME index would leave the second reading zero.
    std::map<std::pair<te::InputDevice*, int>, float> seen;

    for (size_t i = 0; i < channelSets.size(); ++i) {
        float peak = -100.0f;
        bool any = false;
        for (const int channel : channelSets[i]) {
            auto [dev, index] = channelTap(impl_->engine, channel);
            if (dev == nullptr) continue;   // a channel this rig doesn't have
            any = true;

            const auto key = std::make_pair(static_cast<te::InputDevice*>(dev), index);
            auto it = seen.find(key);
            if (it == seen.end()) {
                dev->setEnabled(true);
                if (ctx != nullptr && ctx->getInputFor(dev) == nullptr)
                    ctx->addWaveInputDeviceInstance(*dev);
                it = seen.emplace(key, impl_->inputClientFor(*dev).getAndClearAudioLevel(index).dB).first;
            }
            peak = std::max(peak, it->second);
        }
        out[i] = {any ? peak : -100.0f, any};
    }
    return out;
}

// Live input level per track, in doc order: resolve each track's wave-input device and read the peak since the
// last poll from its LevelMeasurer client — the same signal it would monitor. -100 with no input, or one this
// rig lacks. Read for every track so it indexes like trackLevelsDb, even though only armed ones surface it.
// Reading clears the accumulator, so a device shared by two tracks is polled ONCE and both get that value.
std::vector<float> EngineHost::inputLevelsDb(const std::string& session) const {
    std::vector<float> out(impl_->session(session).current.tracks.size(), -100.0f);
    if (!impl_->session(session).edit) return out;

    std::map<te::InputDevice*, float> perDevice;   // read+clear each device at most once
    for (size_t i = 0; i < impl_->session(session).current.tracks.size(); ++i) {
        const auto& t = impl_->session(session).current.tracks[i];
        if (t.inputChannels.empty()) continue;
        auto* dev = findWaveInput(impl_->engine, t.inputChannels);
        if (dev == nullptr) continue;

        auto it = perDevice.find(dev);
        if (it == perDevice.end()) {
            auto& client = impl_->inputClientFor(*dev);
            const float l = client.getAndClearAudioLevel(0).dB;
            const float r = client.getAndClearAudioLevel(1).dB;
            it = perDevice.emplace(dev, std::max(l, r)).first;
        }
        out[i] = it->second;
    }
    return out;
}

void EngineHost::onRecorded(std::function<void(const std::string&, const std::string&,
                                               double, double)> cb) {
    impl_->recordedCb = std::move(cb);
}

// Name each armed track's take and point its device at recordDir, from play(session), so the timestamp is the take's
// start. Tracktion builds the path from the device's filename MASK and force-appends "_%take%" when the mask
// omits it — so the mask alone cannot produce the name we want. We use it only to fix the DIRECTORY, so a long
// take streams straight to its final disk, and rename within that directory when it finishes.
bool EngineHost::prepareTakes(const std::string& session) {
    impl_->session(session).pendingTakes.clear();
    const auto armed = armedTracks(session);
    if (armed.empty()) return false;
    if (impl_->session(session).current.recordDir.empty()) {
        std::cerr << "[rec] no record directory — refusing to record\n";
        return false;
    }

    const auto now = juce::Time::getCurrentTime();
    const auto stamp = juce::String::formatted("%02d%02d%02d%02d%02d%02d",
                                               now.getYear() % 100, now.getMonth() + 1,
                                               now.getDayOfMonth(), now.getHours(),
                                               now.getMinutes(), now.getSeconds());
    for (const auto& id : armed) {
        const TrackDoc* td = nullptr;
        for (const auto& t : impl_->session(session).current.tracks)
            if (t.id == id) { td = &t; break; }
        if (td == nullptr) continue;

        const auto base = juce::File::createLegalFileName(juce::String(td->name)) + "-" + stamp;
        impl_->session(session).pendingTakes[id] = base.toStdString();

        auto ti = findTrackInput(impl_->session(session).edit.get(), impl_->engine, impl_->session(session).current, id);
        if (ti.instance == nullptr) continue;
        if (auto* wave = dynamic_cast<te::WaveInputDevice*>(&ti.instance->getInputDevice()))
            wave->setFilenameMask(juce::File(impl_->session(session).current.recordDir).getChildFile(base).getFullPathName());
        std::cerr << "[rec] track '" << id << "' -> " << base << ".wav\n";
    }
    return true;
}

}  // namespace studio
