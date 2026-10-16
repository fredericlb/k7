// Backpressure.h — what the tunnel and a WebRTC pipe send on to a slow peer: a frame the next one
// supersedes is DROPPED once too much sits unsent, everything else is always sent. Only two kinds
// qualify: the engine's `state` frame and its audio stream's frames, the two the engine itself skips
// for a socket that is behind. Per channel, on one thread. See docs/supervisorPolicy.md.

#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace k7 {

/** Past this many unsent bytes toward a peer, a droppable frame is not sent. */
constexpr size_t kDropAboveBytes = 256 * 1024;

/** A frame the next one makes worthless: the engine's `state`, or a frame of its audio stream. */
bool droppableEngineFrame(const std::string& data, bool binary);

class FrameShedder {
public:
    /** Whether to send this frame, with `buffered` bytes still unsent toward the peer. */
    bool admit(const std::string& data, bool binary, size_t buffered);

    /** The frames dropped since the last report, once the peer has caught up or a minute's worth piled up; else 0. */
    std::uint64_t takeShed();

private:
    std::uint64_t shed_ = 0;
    bool caughtUp_ = true;
};

/** Reported at least this often under a backlog that never clears: a minute of `state` frames. */
constexpr std::uint64_t kShedReportEvery = 1200;

}  // namespace k7
