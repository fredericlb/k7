// RecorderNode.h — one recorder node's state: its ring, the take being written, and the takes
// already finished. Owned by the SESSION rather than by the plugin, so a rebuild of the chain
// around the node does not end the take. See docs/recorder.md.

#pragma once

#include "RecorderTap.h"
#include "WaveformTap.h"   // WaveformEnvelope — the take's picture uses the live tap's shape

#include <juce_audio_formats/juce_audio_formats.h>

#include <memory>
#include <string>
#include <vector>

namespace studio {

class RecorderNode {
public:
    RecorderTap ring;
    bool recording = false;
    bool damaged = false;   // the take IN PROGRESS lost frames; latched onto it when it closes
    std::vector<RecorderTake> takes;

    /** A stretch of the take's picture: the points, and where they start WITHIN it. A client
     *  appends when `from` is where it had got to, and re-syncs off the overlap when it is not. */
    struct EnvelopeSlice {
        size_t from = 0;
        std::vector<WaveformEnvelope> points;
    };

    void openTake(const juce::File& file, double sampleRate);
    void closeTake();
    /** Move whatever the ring holds onto disk. Called on the state tick; see docs/recorder.md. */
    void pump();
    /** The points not handed out yet, and their offset — the client APPENDS them. */
    EnvelopeSlice drainEnvelope();
    /** Hand the WHOLE picture out on the next drain: what a client that just connected needs. */
    void rewindEnvelope() { sent_ = 0; }
    /** …and forget it, for when the take it draws has been cleared away. */
    void resetEnvelope() {
        envelope_.clear();
        sent_ = 0;
    }

    double seconds() const;
    bool writing() const { return writer_ != nullptr; }
    const juce::File& path() const { return path_; }

private:
    std::unique_ptr<juce::AudioFormatWriter> writer_;
    juce::File path_;
    double rate_ = 0.0;
    size_t frames_ = 0;

    std::vector<float> scratch_;                  // interleaved, straight out of the ring
    std::vector<float> planes_[RecorderTap::CHANNELS];   // …and deinterleaved for the writer

    // The WHOLE take's picture, not just what is unsent: a client that joins mid-take has none
    // of it, and an hour of recording is 340 kB at this bucket. See docs/recorder.md.
    std::vector<WaveformEnvelope> envelope_;
    size_t sent_ = 0;
    int bucketFrames_ = 0;
    float curMin_ = 0.0f;
    float curMax_ = 0.0f;
};

}  // namespace studio
