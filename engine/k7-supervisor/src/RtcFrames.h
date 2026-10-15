// RtcFrames.h — the engine's frames over a WebRTC data channel, the C++ twin of
// packages/web-protocol/rtcFrames.ts: a browser refuses a message past its channel's size limit and
// a project document passes it, so every frame is cut into FRAGMENTS, each opening with one byte
// saying text or binary and whether more follow.

#pragma once

#include <optional>
#include <string>
#include <vector>

namespace k7::rtcframes {

/** Small enough for every browser's data channel, large enough that a document is a handful. */
constexpr size_t kFragmentBytes = 16 * 1024;

/** One frame as the fragments to send, in order; an empty frame is one empty fragment. */
std::vector<std::string> toFragments(const std::string& data, bool binary);

struct Frame {
    std::string data;
    bool binary = false;
};

/** Collects fragments back into frames. */
class Joiner {
public:
    /** A whole frame once its last piece is in, else nothing. */
    std::optional<Frame> push(const std::string& fragment);

private:
    std::string parts_;
};

}  // namespace k7::rtcframes
