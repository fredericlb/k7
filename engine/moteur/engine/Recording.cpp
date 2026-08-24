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

// End of a take: rename the file to what prepareTakes promised, report it, and drop Tracktion's clip — the brain re-adds it and would otherwise double it.
struct RecordListener : public te::TransportControl::Listener {
    // Bound to ONE session: with N projects there is no "the" edit a finished take could be looked up in.
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
                host.impl_->recordedCb(session, trackId, file.getFullPathName().toStdString(),
                                       start, length);
        }
        if (take != host.impl_->session(session).pendingTakes.end()) host.impl_->session(session).pendingTakes.erase(take);
    }

    EngineHost& host;
    std::string session;
};

// Re-attach the listener to the current edit's transport — a fresh Edit brings a fresh listener list — from where RecordListener is a complete type.
void EngineHost::attachRecordListener(const std::string& session) {
    if (!impl_->session(session).recordListener) impl_->session(session).recordListener = std::make_unique<RecordListener>(*this, session);
    if (auto* tc = impl_->transport(session)) tc->addListener(impl_->session(session).recordListener.get());
}

// Wire one track to its declared input, replacing whatever it had; monitor mode and trim belong to the DEVICE, see docs/audioDevice.md.
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
    if (!dev->isEnabled()) {
        // Enabling rebuilds the whole wave-device list and deletes this object, so let it land and resolve the channel set AGAIN (docs/audioDevice.md).
        dev->setEnabled(true);
        impl_->engine.getDeviceManager().dispatchPendingUpdates();
        dev = findWaveInput(impl_->engine, t.inputChannels);
        if (dev == nullptr) return;
        ctx = impl_->session(session).edit->getCurrentPlaybackContext();
        if (ctx == nullptr) return;
    }

    // A context only builds instances for the devices enabled when it was built, so one enabled later needs its instance added by hand.
    if (ctx->getInputFor(dev) == nullptr) ctx->addWaveInputDeviceInstance(*dev);
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
    // Trim, at the DEVICE like the monitor mode above, so two tracks on one physical input share it.
    dev->setInputGainDb(static_cast<float>(t.inputGain));
}

// Wire every track to its input, enabling the DEVICES first and once per distinct channel set — docs/audioDevice.md.
void EngineHost::applyAllTrackInputs(const std::string& session, const ProjectDoc& doc) {
    std::vector<std::vector<int>> toEnable;
    for (const auto& t : doc.tracks) {
        if (t.inputChannels.empty()) continue;
        auto* dev = findWaveInput(impl_->engine, t.inputChannels);
        if (dev == nullptr || dev->isEnabled()) continue;
        if (std::find(toEnable.begin(), toEnable.end(), t.inputChannels) == toEnable.end())
            toEnable.push_back(t.inputChannels);
    }
    for (const auto& channels : toEnable)
        if (auto* dev = findWaveInput(impl_->engine, channels)) dev->setEnabled(true);
    // Once for the batch. applyTrackInput below then finds every device enabled and skips its own.
    if (!toEnable.empty()) impl_->engine.getDeviceManager().dispatchPendingUpdates();

    for (const auto& t : doc.tracks) applyTrackInput(session, t);
}

// Put every session's live inputs and arm flags back after the INTERFACE changed under them, dispatching the async rebuild first — docs/audioDevice.md.
void EngineHost::reconnectTrackInputs(
    const std::map<std::string, std::vector<std::string>>& armedBefore) {
    impl_->engine.getDeviceManager().dispatchPendingUpdates();

    for (const auto& sid : impl_->ids()) {
        auto* s = impl_->find(sid);
        if (s == nullptr || !s->edit) continue;
        applyAllTrackInputs(sid, s->current);

        // Re-arm what was armed; a refusal is normal when the new interface does not carry that track's channels.
        const auto it = armedBefore.find(sid);
        if (it == armedBefore.end()) continue;
        for (const auto& trackId : it->second)
            if (auto r = setArmed(sid, trackId, true); !r.ok)
                std::cerr << "[rec] '" << trackId << "' could not be re-armed on the new interface: "
                          << r.error << '\n';
    }
}

// --- Record arming -----------------------------------------------------------

EngineHost::ArmResult EngineHost::setArmed(const std::string& session, const std::string& trackId,
                                           std::optional<bool> armed) {
    // Every refusal names what is wrong: from the UI, no such track / no input / a channel this rig lacks / nothing loaded all look identical.
    const auto refuse = [](std::string why) { return ArmResult{false, false, std::move(why)}; };
    // No such session takes the same branch as a session with no Edit: from the UI they are one fault.
    auto* s = impl_->find(session);
    if (s == nullptr || !s->edit) return refuse("no project loaded");

    const TrackDoc* td = nullptr;
    for (const auto& t : impl_->session(session).current.tracks)
        if (t.id == trackId) { td = &t; break; }
    // Deliberately NOT the brain's wording: reaching here is a skew between the two songs, and different words tell the two faults apart.
    if (td == nullptr)
        return refuse("the engine's loaded song has no track \"" + trackId
                      + "\" — send the project first");
    if (td->inputChannels.empty())
        return refuse("track \"" + trackId + "\" has no input — nothing to record");

    auto ti = findTrackInput(impl_->session(session).edit.get(), impl_->engine, impl_->session(session).current, trackId);
    if (ti.instance == nullptr) {
        // The song declares an input this interface doesn't offer, so arming would capture nothing.
        std::string chans;
        for (int ch : td->inputChannels) chans += ' ' + std::to_string(ch);
        return refuse("track \"" + trackId + "\": no interface input on channel(s)" + chans);
    }

    const bool want = armed.value_or(!ti.instance->isRecordingEnabled(ti.track->itemID));
    // Refuse here rather than at stop: a take with nowhere to go is worse than never arming, and disarming stays allowed.
    if (want && impl_->session(session).current.recordDir.empty())
        return refuse("this song has no clips/ directory to record into");

    ti.instance->setRecordingEnabled(ti.track->itemID, want);
    std::cerr << "[rec] track '" << trackId << "' " << (want ? "armed" : "disarmed") << '\n';
    return {true, want, {}};
}

std::vector<std::string> EngineHost::armedTracks(const std::string& session) const {
    std::vector<std::string> out;
    auto* s = impl_->find(session);
    if (s == nullptr || !s->edit) return out;
    for (const auto& t : s->current.tracks) {
        auto ti = findTrackInput(s->edit.get(), impl_->engine, s->current, t.id);
        if (ti.instance != nullptr && ti.instance->isRecordingEnabled(ti.track->itemID))
            out.push_back(t.id);
    }
    return out;
}

// The device carrying one 1-based interface channel, and its index inside it — not findWaveInput, whose exact match reads a paired rig as silence (docs/inputTuner.md).
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
    // The tap attaches on the first ask and stays: detaching it per poll would restart the rings and no reading would settle.
    if (!impl_->tunerAttached) {
        impl_->engine.getDeviceManager().deviceManager.addAudioCallback(&impl_->tuner);
        impl_->tunerAttached = true;
    }

    // Watch exactly what was asked for, and only the FIRST channel of each set — a stereo pair carries one instrument.
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

bool EngineHost::setInputStereo(int channel, bool stereo) {
    if (channel < 1) return false;
    auto& dm = impl_->engine.getDeviceManager();
    // No interface open means no channels to group; the device list is rebuilt from the open device.
    if (dm.deviceManager.getCurrentAudioDevice() == nullptr) return false;

    // Regrouping destroys the wave-input devices exactly as a device switch does, so read what was armed BEFORE (docs/audioDevice.md).
    std::map<std::string, std::vector<std::string>> armedBefore;
    for (const auto& sid : impl_->ids())
        if (auto armed = armedTracks(sid); !armed.empty()) armedBefore[sid] = std::move(armed);

    // 1-based on the wire, 0-based here, and setDeviceInChannelStereo rounds down to even — so either half names the same pair.
    dm.setDeviceInChannelStereo(channel - 1, stereo);
    // Dispatches the async rebuild and then re-wires, so the next io-levels on this thread already reads the NEW grouping.
    reconnectTrackInputs(armedBefore);
    return true;
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

// Peak dB per channel set, read off the INTERFACE's raw inputs through the tuner's tap rather than through Tracktion's routing — docs/inputTuner.md.
std::vector<EngineHost::ChannelLevel>
EngineHost::channelLevelsDb(const std::vector<std::vector<int>>& channelSets) {
    std::vector<ChannelLevel> out(channelSets.size());
    // Attach on the first ask and stay, exactly as channelPitches does; detaching between polls would restart the accumulation.
    if (!impl_->tunerAttached) {
        impl_->engine.getDeviceManager().deviceManager.addAudioCallback(&impl_->tuner);
        impl_->tunerAttached = true;
    }
    const int have = impl_->tuner.inputChannels();

    // Read+clear each channel at most once per call: a channel asked for twice would report silence on the second, cleared read.
    std::map<int, float> seen;

    for (size_t i = 0; i < channelSets.size(); ++i) {
        float peak = -100.0f;
        bool any = false;
        for (const int channel : channelSets[i]) {
            if (channel < 1 || channel > have) continue;   // a channel this rig doesn't have
            any = true;
            auto it = seen.find(channel);
            if (it == seen.end())
                it = seen.emplace(channel,
                                  juce::Decibels::gainToDecibels(
                                      impl_->tuner.getAndClearPeak(channel), -100.0f))
                         .first;
            peak = std::max(peak, it->second);
        }
        out[i] = {any ? peak : -100.0f, any};
    }
    return out;
}

// Live input level per track, in doc order and -100 where there is none: reading clears the accumulator, so a device two tracks share is polled ONCE.
std::vector<float> EngineHost::inputLevelsDb(const std::string& session) const {
    auto* s = impl_->find(session);
    if (s == nullptr) return {};
    std::vector<float> out(s->current.tracks.size(), -100.0f);
    if (!s->edit) return out;

    std::map<te::InputDevice*, float> perDevice;   // read+clear each device at most once
    for (size_t i = 0; i < s->current.tracks.size(); ++i) {
        const auto& t = s->current.tracks[i];
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
                                               const std::string&, double, double)> cb) {
    impl_->recordedCb = std::move(cb);
}

// Name each armed track's take and aim its device at recordDir: the filename MASK force-appends "_%take%", so it only fixes the DIRECTORY and the rename comes at the end.
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
