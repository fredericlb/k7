// Recorder: the RECORDER node's per-session state — starting and stopping a take, draining its
// ring onto a wav, popping the last one, and reporting all of it for the state frame. An
// EngineHost member file for Recording.cpp's reason: these read impl_->session(...), which lives
// on EngineHost. Full rationale: docs/recorder.md.

#include "EngineHost.h"

#include "EngineTypes.h"       // Tracktion/JUCE + the te/tt/fs aliases
#include "EngineHostImpl.h"    // struct EngineHost::Impl
#include "RecorderPlugin.h"
#include "Warnings.h"          // a refused record has to reach the client, not just stderr

#include <algorithm>
#include <iostream>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace studio {

namespace {

// How many frames one drain moves at most: ~0.5 s at 48 kHz, comfortably more than a 20 Hz tick
// needs, so a late tick catches up in one pass instead of falling further behind every time.
constexpr size_t kDrainChunk = 24000;

// How long a node whose plugin left keeps its ring, in ms: far longer than Tracktion takes to swap in the graph without it.
constexpr double kRetiredRingMs = 2000.0;

// How often the WAV header is rewritten mid-take, in seconds: it is only correct after a flush, so a crash keeps the take up to the last one.
constexpr double kFlushSeconds = 1.0;

// Samples per envelope point on the TAKE's picture — 4096 is ~12 points a second, which draws a
// five-minute take in 3500 points. The live tap's bucket is 256; this one is not the same picture.
constexpr int kTakeBucket = 4096;

// `260827T143208` — the shape fileStamp() writes on the TypeScript side, so a take recorded here
// and a bounce made there sort together in a directory listing.
juce::String stampNow() {
    const auto now = juce::Time::getCurrentTime();
    return juce::String::formatted("%02d%02d%02dT%02d%02d%02d", now.getYear() % 100,
                                   now.getMonth() + 1, now.getDayOfMonth(), now.getHours(),
                                   now.getMinutes(), now.getSeconds());
}

}  // namespace

// --- one node's state --------------------------------------------------------

void RecorderNode::openTake(const juce::File& file, double sampleRate) {
    closeTake();
    // 32-bit float, the rate the samples ARE at: a take is raw capture, and converting it here
    // would be a decision the person saving it has not made yet.
    juce::WavAudioFormat wav;
    auto stream = std::make_unique<juce::FileOutputStream>(file);
    if (!stream->openedOk()) {
        std::cerr << "[rec] cannot write " << file.getFullPathName() << '\n';
        return;
    }
    writer_.reset(wav.createWriterFor(stream.release(), sampleRate, RecorderTap::CHANNELS, 32, {},
                                      0));
    if (writer_ == nullptr) {
        std::cerr << "[rec] no wav writer for " << file.getFullPathName() << '\n';
        return;
    }
    path_ = file;
    frames_ = 0;
    flushedAt_ = 0;
    writeFailed_ = false;
    rate_ = sampleRate;
    envelope_.clear();
    sent_ = 0;
    bucketFrames_ = 0;
    ring.skipToLive();   // the take begins at the press, not at whatever is still in the ring
}

void RecorderNode::closeTake() {
    if (writer_ == nullptr) return;
    writer_->flush();
    writer_.reset();   // the stream is the writer's; closing it is what makes the file playable
}

/** Move whatever the ring holds onto disk, and grow the take's picture with it. */
void RecorderNode::pump() {
    if (writer_ == nullptr) return;
    auto d = ring.drain(scratch_, kDrainChunk);
    if (d.lostFrames > 0) damaged = true;
    if (d.frames == 0) return;

    // Deinterleaved for the writer, which takes one pointer per channel.
    float* chans[RecorderTap::CHANNELS] = {};
    for (int c = 0; c < RecorderTap::CHANNELS; ++c) {
        planes_[(size_t)c].resize(d.frames);
        for (size_t i = 0; i < d.frames; ++i)
            planes_[(size_t)c][i] = scratch_[i * RecorderTap::CHANNELS + (size_t)c];
        chans[c] = planes_[(size_t)c].data();
    }
    // A refused write is a full disk or a vanished directory, and JUCE refuses every later one too: the take ends here, damaged.
    if (!writer_->writeFromFloatArrays(chans, RecorderTap::CHANNELS, (int)d.frames)) {
        damaged = true;
        writeFailed_ = true;
        warn("recording to " + path_.getFullPathName().toStdString() +
                 " failed — the disk is full or the folder is gone; the take keeps what was written",
             "rec");
        closeTake();
        return;
    }
    frames_ += d.frames;
    if ((double)(frames_ - flushedAt_) >= kFlushSeconds * rate_) {
        writer_->flush();
        flushedAt_ = frames_;
    }

    // …and the same samples again as min/max buckets: the card draws THIS, not the file.
    for (size_t i = 0; i < d.frames; ++i) {
        const float l = scratch_[i * RecorderTap::CHANNELS];
        const float r = scratch_[i * RecorderTap::CHANNELS + 1];
        const float lo = l < r ? l : r;
        const float hi = l < r ? r : l;
        if (bucketFrames_ == 0) { curMin_ = lo; curMax_ = hi; }
        else { if (lo < curMin_) curMin_ = lo; if (hi > curMax_) curMax_ = hi; }
        if (++bucketFrames_ >= kTakeBucket) {
            envelope_.push_back({ curMin_, curMax_ });
            bucketFrames_ = 0;
        }
    }
}

/** The points not handed out yet, and where they sit in the take — docs/recorder.md. The picture
 *  itself is KEPT: `rewindEnvelope` hands it out whole again for a client that has none of it. */
RecorderNode::EnvelopeSlice RecorderNode::drainEnvelope() {
    EnvelopeSlice out;
    out.from = sent_;
    if (sent_ < envelope_.size())
        out.points.assign(envelope_.begin() + (std::ptrdiff_t)sent_, envelope_.end());
    sent_ = envelope_.size();
    return out;
}

double RecorderNode::seconds() const {
    return rate_ > 0.0 ? (double)frames_ / rate_ : 0.0;
}

// --- the host ----------------------------------------------------------------

// The ring lives HERE and not on the plugin, so rebuilding the chain around a node does not end
// the take: the new plugin is pointed back at the ring that was already filling.
RecorderNode& EngineHost::recorderNode(const std::string& session, const std::string& id) {
    auto& map = impl_->session(session).recorders;
    auto it = map.find(id);
    if (it == map.end())
        it = map.emplace(id, std::make_unique<RecorderNode>()).first;
    return *it->second;
}

void EngineHost::attachRecorderTaps(const std::string& session) {
    auto* s = impl_->find(session);
    if (s == nullptr) return;
    for (auto& [id, plugin] : s->pluginsById) {
        auto* rec = dynamic_cast<RecorderPlugin*>(plugin.get());
        if (rec == nullptr) continue;
        rec->setTap(&recorderNode(session, id).ring);
    }
    // A node that left the document goes with its ring; one still RECORDING is filed first and kept one more pass, so its take is reported (docs/recorder.md).
    std::vector<std::string> orphaned;
    for (const auto& [id, node] : s->recorders)
        if (node->recording && s->pluginsById.find(id) == s->pluginsById.end()) orphaned.push_back(id);
    for (const auto& id : orphaned) setRecorderRecording(session, id, false);
    for (auto it = s->recorders.begin(); it != s->recorders.end();) {
        const bool gone = s->pluginsById.find(it->first) == s->pluginsById.end();
        const bool justFiled = std::find(orphaned.begin(), orphaned.end(), it->first) != orphaned.end();
        if (gone && !it->second->recording && !justFiled) {
            it->second->closeTake();
            s->retiredRecorders.emplace_back(juce::Time::getMillisecondCounterHiRes(), std::move(it->second));
            it = s->recorders.erase(it);
        } else {
            ++it;
        }
    }
}

EngineHost::RecorderResult EngineHost::setRecorderRecording(const std::string& session,
                                                            const std::string& id, bool on) {
    auto* s = impl_->find(session);
    if (s == nullptr) return { false, "no session " + session };
    const auto found = s->pluginsById.find(id);
    const bool present = found != s->pluginsById.end() &&
                         dynamic_cast<RecorderPlugin*>(found->second.get()) != nullptr;

    // A STOP needs the node, not the plugin: a node whose plugin left mid-take must still be stoppable.
    if (!on) {
        const auto held = s->recorders.find(id);
        if (held == s->recorders.end())
            return present ? RecorderResult{ true, "" }
                           : RecorderResult{ false, "no recorder node \"" + id + "\" in this project" };
        auto& node = *held->second;
        if (!node.recording) return { true, "" };   // idempotent: two clients, one light
        node.pump();          // whatever is still in the ring belongs to this take
        node.closeTake();
        node.recording = false;
        node.takes.push_back({ node.path().getFullPathName().toStdString(), node.seconds(),
                               node.damaged });
        return { true, "" };
    }

    if (!present) return { false, "no recorder node \"" + id + "\" in this project" };
    auto& node = recorderNode(session, id);
    if (node.recording) return { true, "" };

    if (s->current.recordDir.empty())
        return { false, "no record directory — this project cannot record" };
    const double rate = node.ring.sampleRate();
    if (rate <= 0.0)
        return { false, "\"" + id + "\" has not carried audio yet — play something through it first" };

    auto dir = juce::File(s->current.recordDir);
    dir.createDirectory();
    const auto name = juce::File::createLegalFileName(juce::String(id)) + "-" + stampNow() + ".wav";
    node.damaged = false;
    // The stamp is to the second, and an existing file would be APPENDED to: a second take within it gets its own name.
    node.openTake(dir.getChildFile(name).getNonexistentSibling(false), rate);
    if (!node.writing()) return { false, "could not open a file for \"" + id + "\"" };
    node.recording = true;
    return { true, "" };
}

EngineHost::RecorderResult EngineHost::clearLastTake(const std::string& session,
                                                     const std::string& id) {
    auto* s = impl_->find(session);
    if (s == nullptr) return { false, "no session " + session };
    auto it = s->recorders.find(id);
    // A take being WRITTEN counts as something to clear, and this asked only about finished ones —
    // so clearing the first take of a session was refused while it was still rolling.
    if (it == s->recorders.end() ||
        (it->second->takes.empty() && !it->second->recording))
        return { false, "\"" + id + "\" has recorded nothing to clear" };
    // Recording is stopped first, which FILES the take and so leaves one to pop below: clearing
    // the take being written would otherwise leave an open writer pointing at a file that is
    // about to stop existing.
    if (it->second->recording) {
        const auto stopped = setRecorderRecording(session, id, false);
        if (!stopped.ok) return stopped;
    }
    auto& takes = it->second->takes;
    // The stop above files one, so this is empty only when the node lost its plugin mid-take.
    if (takes.empty()) return { false, "\"" + id + "\" has recorded nothing to clear" };
    juce::File(takes.back().file).deleteFile();
    takes.pop_back();
    // The picture on every card is of the take just deleted, so the node stops holding it too —
    // otherwise the next client to connect would be sent a drawing of a file that is gone.
    it->second->resetEnvelope();
    return { true, "" };
}

/** Hand every recorder's WHOLE picture out on the next state frame. A client that just connected
 *  holds none of it and the frames carry only what is new, so a reload would draw a take that
 *  looks like it started at the reload. Harmless for the clients that already have it: the frame
 *  says where the points START, and one that is further along keeps only the overlap's tail. */
void EngineHost::rewindRecorderEnvelopes(const std::string& session) {
    auto* s = impl_->find(session);
    if (s == nullptr) return;
    for (auto& [id, node] : s->recorders) node->rewindEnvelope();
}

bool EngineHost::anyRecording(const std::string& session) const {
    const auto* s = impl_->find(session);
    if (s == nullptr) return false;
    for (const auto& [id, node] : s->recorders)
        if (node->recording) return true;
    return false;
}

bool EngineHost::recorderRecording(const std::string& session, const std::string& id) const {
    const auto* s = impl_->find(session);
    if (s == nullptr) return false;
    const auto it = s->recorders.find(id);
    return it != s->recorders.end() && it->second->recording;
}

std::map<std::string, EngineHost::RecorderReport> EngineHost::pumpRecorders(
    const std::string& session) {
    std::map<std::string, RecorderReport> out;
    // find(), never session(): a state poll must not conjure the session it is reporting on.
    auto* s = impl_->find(session);
    if (s == nullptr) return out;
    // A retired ring is freed once the graph that held its plugin is surely gone: Tracktion swaps it within a few blocks.
    const double now = juce::Time::getMillisecondCounterHiRes();
    std::erase_if(s->retiredRecorders, [now](const auto& r) { return now - r.first > kRetiredRingMs; });
    for (auto& [id, node] : s->recorders) {
        if (node->recording && node->writing()) node->pump();
        // A take the disk refused is filed as it stands, damaged, rather than left lit with a clock that stopped.
        if (node->recording && node->writeFailed()) setRecorderRecording(session, id, false);
        RecorderReport r;
        r.recording = node->recording;
        r.seconds = node->recording ? node->seconds() : 0.0;
        r.takes = node->takes;
        auto slice = node->drainEnvelope();
        r.envelopeFrom = slice.from;
        r.envelope = std::move(slice.points);
        out[id] = std::move(r);
    }
    return out;
}

}  // namespace studio
