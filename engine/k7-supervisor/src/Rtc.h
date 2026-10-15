// Rtc.h — the engine machine's end of a WebRTC data channel, answered for a browser that cannot reach
// the engine directly: the offer and answer travel over the tunnel, and the channel is then piped to
// the local engine like any other socket, cut into rtcframes fragments. libdatachannel is what
// node-datachannel wraps, which is also the TS reference agent's, so both answer as one peer. See docs/supervisor.md.

#pragma once

#include <functional>
#include <string>
#include <vector>

namespace k7::rtc {

struct Options {
    int enginePort = 8765;
    /** STUN/TURN servers; none means host candidates only, which is the local network. */
    std::vector<std::string> iceServers;
    /** How long ICE gathering may take before the answer goes with what it has. */
    int gatherMs = 2000;
    std::function<void(const std::string&)> log;
};

/** Answer a browser's offer with an SDP answer; the channel it opens is piped to the engine. Throws. */
std::string answerOffer(const std::string& offer, const Options& opts);

}  // namespace k7::rtc
