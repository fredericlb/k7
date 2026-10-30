// RecorderNode.h — one recorder node's state: its ring, the take being written, and the takes
// already finished. Owned by the SESSION rather than by the plugin, so a rebuild of the chain
// around the node does not end the take. See docs/recorder.md.
//
// Two threads: the message thread owns it, the writer thread pumps it while it is registered.
// What both read — the clock, the damage, the picture — is atomic or under `envMx_`.

#pragma once

#include "RecorderTap.h"
#include "RecorderWriter.h"
#include "WaveformTap.h"   // WaveformEnvelope — the take's picture uses the live tap's shape

#include <juce_audio_formats/juce_audio_formats.h>

#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace studio {

class RecorderNode : public RecorderWriter::Job {
public:
    RecorderTap ring;
    bool recording = false;   // message thread only
    bool closing = false;     // …stopped, the writer still closing the take; filed once it lets go
    bool discardOnClose = false;   // …and a `clear` asked meanwhile: the take is deleted rather than filed
    std::atomic<bool> damaged{false};   // the take IN PROGRESS lost frames; latched onto it when it closes
    std::vector<RecorderTake> takes;

    /** A stretch of the take's picture: the points, and where they start WITHIN it. A client
     *  appends when `from` is where it had got to, and re-syncs off the overlap when it is not. */
    struct EnvelopeSlice {
        size_t from = 0;
        std::vector<WaveformEnvelope> points;
    };

    void openTake(const juce::File& file, double sampleRate);
    void closeTake();
    /** Move whatever the ring holds onto disk: the writer thread's, or the owner's once removed from it. */
    void pump() override;
    /** The writer's, after the last pump of a stopped take: the flush and close that may wait on the disk. */
    void finish() override { closeTake(); }
    /** The points not handed out yet, and their offset — the client APPENDS them. */
    EnvelopeSlice drainEnvelope();
    /** Hand the WHOLE picture out on the next drain: what a client that just connected needs. */
    void rewindEnvelope() {
        std::lock_guard<std::mutex> lock(envMx_);
        sent_ = 0;
    }
    /** …and forget it, for when the take it draws has been cleared away. */
    void resetEnvelope() {
        std::lock_guard<std::mutex> lock(envMx_);
        envelope_.clear();
        sent_ = 0;
    }

    double seconds() const;
    /** Owner thread, and only while the writer does not hold the node. */
    bool writing() const { return writer_ != nullptr; }
    /** The disk refused a write: the take is closed where it stood, and stays recording until stopped. */
    bool writeFailed() const { return writeFailed_.load(std::memory_order_acquire); }
    const juce::File& path() const { return path_; }

private:
    std::unique_ptr<juce::AudioFormatWriter> writer_;
    juce::File path_;
    double rate_ = 0.0;        // set by openTake before the writer is handed the node
    std::atomic<size_t> frames_{0};
    size_t flushedAt_ = 0;     // frames_ when the header last went to disk
    std::atomic<bool> writeFailed_{false};

    std::vector<float> scratch_;                  // interleaved, straight out of the ring
    std::vector<float> planes_[RecorderTap::CHANNELS];   // …and deinterleaved for the writer

    // The WHOLE take's picture, not just what is unsent: a client that joins mid-take has none
    // of it, and an hour of recording is 340 kB at this bucket. See docs/recorder.md.
    std::mutex envMx_;   // never held across a disk write, so a state tick never waits on one
    std::vector<WaveformEnvelope> envelope_;
    size_t sent_ = 0;
    std::vector<WaveformEnvelope> fresh_;   // a pump's new points, appended under the lock in one go
    int bucketFrames_ = 0;
    float curMin_ = 0.0f;
    float curMax_ = 0.0f;
};

}  // namespace studio
